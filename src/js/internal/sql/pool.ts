import type { QueryStrings, Query as QueryType } from "./query";
import type { ArrayType, DatabaseAdapter, SQLArrayParameter, TransactionCommands } from "./shared";

const { SQLQueryFlags, onQuerySettled } = require("internal/sql/query");
const { isUnsafeTransactionStart, normalizeQuery } = require("internal/sql/shared");
const AsyncContextFrame = require("internal/async_context_frame");
const { isStoppedModuleGraphRunning } = require("internal/shared");
const monotonicNowMs = $newRustFunction("runtime/timer/Timer.rs", "internal_bindings.monotonicNowMs", 0);
/// how many times `bun --hot` has reloaded the program, -1 without --hot
const hotReloadGeneration = $newRustFunction("jsc_hooks.rs", "hotReloadGeneration", 0);

const enum PooledConnectionState {
  connecting = 0,
  open = 1,
  closed = 2,
}

const enum PooledConnectionFlags {
  reserved = 1 << 0,
  retiring = 1 << 1,
  /// It has a prepared distributed transaction. MariaDB reports a transaction until that is committed or rolled back.
  prepared = 1 << 2,
}
export type { BasePooledConnection };

interface NativeConnection {
  close(): void;
  flush(): void;
  hold(): void;
  unhold(): void;
  /// a boolean: the server's word after its last complete reply
  readonly inTransaction: unknown;
}

type OnConnected = (err: Error | null, connection: any) => void;

/// In the pool's queue: a caller that wants a connection for itself. A query is queued as its bare callback.
class Reservation {
  onConnected: OnConnected;
  constructor(onConnected: OnConnected) {
    this.onConnected = onConnected;
  }
}

/// connecting -> open -> closed, never back: whatever still holds a closed one cannot reach the one that replaced it.
abstract class BasePooledConnection<ConnectionHandle extends NativeConnection = any> {
  adapter: BaseSQLAdapter<any, any, any>;
  connection: ConnectionHandle | null = null;
  state: PooledConnectionState = PooledConnectionState.connecting;
  closeHandlers: Set<(err: Error) => void> = new Set();
  flags: number = 0;
  /// queryCount is used to indicate the number of queries using the connection, if a connection is reserved or if its a transaction queryCount will be 1 independently of the number of queries
  queryCount: number = 0;
  connectStartedAt: number = monotonicNowMs();
  connectAttempts: number = 0;
  retryTimer: ReturnType<typeof setTimeout> | null = null;
  #releaseQuery: () => void;

  constructor(adapter: BaseSQLAdapter<any, any, any>) {
    this.adapter = adapter;
    this.#releaseQuery = adapter.release.bind(adapter, this);
  }

  protected abstract startConnection(): Promise<void>;
  /**
   * Whether the error is a connect failure (the server accepted the
   * connection but closed it before the handshake completed) that a backoff
   * retry can fix.
   */
  protected abstract isConnectFailureError(err: Error | null): boolean;

  protected nativeCallback(method: (...args: any[]) => void): (...args: any[]) => void {
    return this.adapter.ownerCallback(method.bind(this));
  }

  /// The pool calls it once the connection is in `connections`: a function-valued password is user code.
  async dial() {
    try {
      await this.adapter.runAsOwner(this.startConnection, this);
    } catch (err) {
      // nothing was dialed: the password function threw, or an option is refused
      this.handleClose(err as Error);
    }
    if (this.state === PooledConnectionState.closed) {
      this.connection?.close();
      this.connection = null;
    }
  }

  protected handleConnected(_err: null, connection: ConnectionHandle) {
    if (this.state !== PooledConnectionState.connecting) {
      return;
    }
    this.connection = connection;
    this.state = PooledConnectionState.open;
    this.adapter.connectionOpened(this);
  }

  protected handleClose(err: Error) {
    if (this.state === PooledConnectionState.closed) {
      return;
    }
    this.connection = null;
    if (this.state === PooledConnectionState.connecting && this.isConnectFailureError(err) && this.#canKeepRetrying()) {
      const delay = Math.min(20 * 2 ** ++this.connectAttempts, 1000);
      this.retryTimer = setTimeout(BasePooledConnection.#retryTimerFired, delay, this, err);
      return;
    }
    this.#finishClose(err);
  }

  /// maxLifetime ran out while it was busy. The native connection closes itself when it is idle.
  protected handleRetire() {
    if (this.state !== PooledConnectionState.open) {
      return;
    }
    this.flags |= PooledConnectionFlags.retiring;
    this.adapter.readyConnections.delete(this);
  }

  retire() {
    this.handleRetire();
    if (this.queryCount === 0) {
      this.close();
    }
  }

  /// bun --hot: `adapter` replaced the pool that dialed it.
  moveTo(adapter: BaseSQLAdapter<any, any, any>) {
    this.adapter = adapter;
    this.#releaseQuery = adapter.release.bind(adapter, this);
  }

  static #retryTimerFired(self: BasePooledConnection, err: Error) {
    self.retryTimer = null;
    if (self.#canKeepRetrying()) {
      self.dial();
    } else {
      self.#finishClose(err);
    }
  }

  #canKeepRetrying(): boolean {
    const adapter = this.adapter;
    if (adapter.closed || adapter.queue.length === 0) {
      return false;
    }
    // an explicit connectionTimeout of 0 disables the connect timer, and with it the retry budget
    const connectionTimeout = adapter.connectionInfo.connectionTimeout ?? 30 * 1000;
    return connectionTimeout > 0 && monotonicNowMs() - this.connectStartedAt < connectionTimeout;
  }

  #finishClose(err: Error) {
    const established = this.state === PooledConnectionState.open;
    this.state = PooledConnectionState.closed;
    this.flags = 0;
    // a password function can throw anything
    this.adapter.connectionClosed(this, err || this.adapter.connectionClosedError(), established);
  }

  /// For the pool's teardown: the connection has left the pool when it returns.
  destroy() {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.connection?.close();
    if (this.state !== PooledConnectionState.closed) {
      // no native connection: a parked retry, or a password that is still awaited
      this.#finishClose(this.adapter.connectionClosedError());
    }
  }

  bindQuery(query: QueryType<any, any>) {
    onQuerySettled(query, this.#releaseQuery);
  }

  close() {
    if (this.state === PooledConnectionState.open) {
      this.connection!.close();
    }
  }
  flush() {
    this.connection?.flush();
  }
}

function closeTimeoutMs(options?: { timeout?: number }): number | undefined {
  const timeout = options?.timeout;
  if (timeout == null) {
    return undefined;
  }
  const seconds = Number(timeout);
  if (seconds > 2 ** 31 || seconds < 0 || seconds !== seconds) {
    throw $ERR_INVALID_ARG_VALUE("options.timeout", seconds, "must be a non-negative integer less than 2^31");
  }
  // setTimeout turns a longer delay into 1 ms
  return Math.min(seconds * 1000, 2 ** 31 - 1);
}

function idleFirst(a: BasePooledConnection, b: BasePooledConnection) {
  return a.queryCount - b.queryCount;
}

function sameOption(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (!$isObject(a) || !$isObject(b)) {
    return false;
  }
  if ($isArray(a)) {
    if (!$isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!sameOption(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  if (ArrayBuffer.isView(a)) {
    return (
      ArrayBuffer.isView(b) &&
      Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength))
    );
  }
  const prototype = Object.getPrototypeOf(a);
  if ((prototype !== null && prototype !== Object.prototype) || Object.getPrototypeOf(b) !== prototype) {
    return false;
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) {
    return false;
  }
  for (let i = 0; i < keys.length; i++) {
    if (!sameOption(a[keys[i]], b[keys[i]])) {
      return false;
    }
  }
  return true;
}

/// Every option that createPooledConnectionHandle() reads, but `transform`.
const connectionSettings = [
  "adapter",
  "hostname",
  "port",
  "username",
  "password",
  "database",
  "path",
  "sslMode",
  "tls",
  "query",
  "prepare",
  "idleTimeout",
  "connectionTimeout",
  "maxLifetime",
  "allowPublicKeyRetrieval",
  "foundRows",
  "channelBinding",
] as const;

function sameSettings(a: BaseSQLAdapter<any, any, any>, b: BaseSQLAdapter<any, any, any>): boolean {
  const x = a.connectionInfo;
  const y = b.connectionInfo;
  // A password that is made for each dial has no value to compare. A Bun.ModuleGraph's connections go with it.
  if ($isObject(x.password) || a.ownerGraphFrame !== undefined || b.ownerGraphFrame !== undefined) {
    return false;
  }
  for (let i = 0; i < connectionSettings.length; i++) {
    if (!sameOption(x[connectionSettings[i]], y[connectionSettings[i]])) {
      return false;
    }
  }
  return x.transform?.column.from === y.transform?.column.from;
}

/// bun --hot only. This module and the open connections outlive a reload, the `new SQL()` of the program does not.
const hotPools = new Set<BaseSQLAdapter<any, any, any>>();

function rememberHotPool(pool: BaseSQLAdapter<any, any, any>) {
  for (const other of hotPools) {
    if (other.generation < pool.generation - 1 && other.connections.length === 0) {
      hotPools.delete(other);
    }
  }
  hotPools.add(pool);
}

/// The settings changed: what earlier loads left open and no pool of this load would take over closes.
function retireReplacedPools(generation: number) {
  for (const stale of hotPools) {
    if (stale.generation === generation || stale.connections.length === 0) {
      continue;
    }
    let successor = false;
    for (const pool of hotPools) {
      if (pool.generation === generation && sameSettings(stale, pool)) {
        successor = true;
        break;
      }
    }
    if (!successor) {
      stale.retire();
    }
  }
}

/// SCRAM hashes SASLprep(password) (RFC 4013). A password that SASLprep refuses is used as it is, like in libpq.
function saslprep(password: string): string {
  const mapped = password
    .replace(/[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000]/g, " ")
    .replace(/\u034f|\u200d|[\ufe00-\ufe0f]|[\u00ad\u1806\u180b-\u180d\u200c\u2060\ufeff]/g, "");
  return mapped === "" || /\p{C}/u.test(mapped) ? password : mapped.normalize("NFKC");
}

/**
 * Resolves the password (which may be a function and/or a promise) and calls
 * the driver's native createConnection with the normalized pool options.
 * A driver ignores the trailing arguments it does not take.
 */
async function createPooledConnectionHandle<ConnectionHandle>(
  nativeCreateConnection: (...args: any[]) => ConnectionHandle,
  options: Bun.SQL.__internal.DefinedPostgresOrMySQLOptions,
  onConnected: (err: Error | null, connection: ConnectionHandle) => void,
  onClose: (err: Error | null) => void,
  onRetire: (() => void) | undefined,
  pooled?: BasePooledConnection,
): Promise<ConnectionHandle | null> {
  const {
    hostname,
    port,
    username,
    tls,
    query,
    database,
    sslMode,
    idleTimeout = 0,
    connectionTimeout = 30 * 1000,
    maxLifetime = 0,
    prepare = true,
    path,
    allowPublicKeyRetrieval = false,
    foundRows,
    channelBinding,
    transform,
  } = options;

  // What script of a disposed Bun.ModuleGraph starts does not start: nothing is dialed, and what
  // waits for this connection waits.
  if (isStoppedModuleGraphRunning()) return null;

  let password: Bun.MaybePromise<string> | string | undefined | (() => Bun.MaybePromise<string>) = options.password;

  if (typeof password === "function") {
    password = password();
  }

  if (password && $isPromise(password)) {
    password = await password;
  }

  // the pool was torn down while the password was made
  if (pooled?.state === PooledConnectionState.closed) return null;

  return nativeCreateConnection(
    hostname,
    Number(port),
    username || "",
    password || "",
    database || "",
    sslMode,
    tls || null,
    query || "",
    path || "",
    onConnected,
    onClose,
    idleTimeout,
    connectionTimeout,
    maxLifetime,
    !prepare,
    !!allowPublicKeyRetrieval,
    onRetire,
    foundRows,
    channelBinding === "disable" ? 0 : channelBinding === "require" ? 2 : 1,
    transform?.column.from,
    saslprep(password || ""),
  );
}

abstract class BaseSQLAdapter<
  PooledConnection extends BasePooledConnection,
  ConnectionHandle,
  QueryHandle,
> implements DatabaseAdapter<PooledConnection, ConnectionHandle, QueryHandle> {
  public readonly connectionInfo: Bun.SQL.__internal.DefinedPostgresOrMySQLOptions;

  /// Every connection that is connecting or open. One enters before it dials and leaves when it closes.
  public readonly connections: PooledConnection[] = [];
  public readonly readyConnections: Set<PooledConnection> = new Set();

  public queue: Array<OnConnected | Reservation> = [];

  public totalQueries: number = 0;
  public readonly generation: number = hotReloadGeneration();
  #closing: PromiseWithResolvers<void> | null = null;
  #tornDown: boolean = false;
  #closeTimers: ReturnType<typeof setTimeout>[] = [];
  /// AsyncLocalStorage context the SQL instance was created in. onconnect/onclose run
  /// inside it rather than in whatever context the native callback happens to fire in
  /// (none for a socket event, the close() caller's when the socket closes synchronously).
  public readonly callbackAsyncContext: unknown;
  /// The Bun.ModuleGraph context frame the SQL instance was created inside of, if any:
  /// every connection of the pool is opened in it, so it belongs to that graph.
  public readonly ownerGraphFrame: unknown;

  /// Calls `dial` as the SQL instance's owner, whoever is calling: a connection is its owner's,
  /// the Bun.ModuleGraph the instance was made in (a redial starts from a close event, which has
  /// no async context), or no graph's when the host made it, even if a graph's query or listen()
  /// is what makes it dial. That graph's dispose() would otherwise close the host's connection
  /// under the host, and its leftover script could leave the host waiting for one never opened.
  public runAsOwner<This, Result>(dial: (this: This) => Result, thisValue: This): Result {
    const graphFrame = this.ownerGraphFrame;
    return graphFrame === undefined && AsyncContextFrame.currentGraph() === undefined
      ? dial.$call(thisValue)
      : AsyncContextFrame.run(graphFrame, dial, thisValue);
  }

  /// `callback` for a native connection to call (from a socket event, which has no async
  /// context): as the SQL instance's owner, so a retry timer it arms is the owner's too, and is
  /// cancelled with the Bun.ModuleGraph that owns the instance.
  public ownerCallback<Args extends unknown[]>(callback: (...args: Args) => void): (...args: Args) => void {
    const graphFrame = this.ownerGraphFrame;
    if (graphFrame === undefined) return callback;
    return AsyncContextFrame.run.bind(undefined, graphFrame, callback, undefined);
  }

  public runUserCallback(callback: ((err: Error | null) => void) | undefined, err: Error | null) {
    if (callback) {
      try {
        AsyncContextFrame.run(this.callbackAsyncContext, callback, this.connectionInfo, err);
      } catch (thrown) {
        reportError(thrown);
      }
    }
  }

  constructor(connectionInfo: Bun.SQL.__internal.DefinedPostgresOrMySQLOptions) {
    this.connectionInfo = connectionInfo;
    this.ownerGraphFrame = AsyncContextFrame.currentGraphFrame();
    this.callbackAsyncContext =
      connectionInfo.onconnect || connectionInfo.onclose ? AsyncContextFrame.current() : undefined;
    if (this.generation !== -1) {
      rememberHotPool(this);
    }
  }

  get closed(): boolean {
    return this.#closing !== null;
  }

  protected abstract createPooledConnection(): PooledConnection;
  abstract createQueryHandle(sql: string, values: unknown[], flags: number): QueryHandle;
  abstract array(values: any[], typeNameOrID?: number | ArrayType): SQLArrayParameter;
  abstract getTransactionCommands(options?: string): TransactionCommands;
  abstract getDistributedTransactionCommands(name: string): TransactionCommands | null;
  abstract getCommitDistributedSQL(name: string): string;
  abstract getRollbackDistributedSQL(name: string): string;
  abstract escapeIdentifier(name: string): string;
  abstract connectionClosedError(): Error;
  abstract notTaggedCallError(): Error;
  abstract queryCancelledError(): Error;
  abstract invalidTransactionStateError(message: string): Error;
  abstract unsafeTransactionError(): Error;

  placeholder(_index: number): string {
    return "?";
  }

  normalizeQuery(strings: QueryStrings, values: unknown[]): [string, unknown[]] {
    return normalizeQuery(this, strings, values);
  }

  protected checkUnsafeTransaction(sql: string, flags: number) {
    if (
      !(flags & SQLQueryFlags.allowUnsafeTransaction) &&
      this.connectionInfo.max !== 1 &&
      isUnsafeTransactionStart(sql)
    ) {
      throw this.unsafeTransactionError();
    }
  }

  supportsReservedConnections() {
    return true;
  }

  cancelConnect(onConnected: OnConnected): boolean {
    const queue = this.queue;
    for (let i = 0; i < queue.length; i++) {
      const waiter = queue[i];
      if (waiter === onConnected || (waiter as Reservation).onConnected === onConnected) {
        queue.splice(i, 1);
        // the callers behind it may have waited for it
        this.#serve();
        this.#closeIfDrained();
        return true;
      }
    }
    return false;
  }

  getConnectionForQuery(pooledConnection: PooledConnection) {
    if (pooledConnection.state !== PooledConnectionState.open) {
      throw this.connectionClosedError();
    }
    return pooledConnection.connection;
  }

  attachConnectionCloseHandler(connection: PooledConnection, handler: (err: Error) => void): void {
    connection.closeHandlers.add(handler);
  }

  detachConnectionCloseHandler(connection: PooledConnection, handler: (err: Error) => void): void {
    connection.closeHandlers.delete(handler);
  }

  validateTransactionOptions(options: string): { valid: boolean; error?: string } {
    // The string is interpolated into the BEGIN/START TRANSACTION statement, so refuse
    // anything that could terminate the statement or start a new one.
    if (!/^[A-Za-z ,]*$/.test(options)) {
      return {
        valid: false,
        error: "Transaction options can only contain letters, spaces, and commas.",
      };
    }
    return { valid: true };
  }

  validateDistributedTransactionName(name: string): { valid: boolean; error?: string } {
    if (typeof name !== "string") {
      return {
        valid: false,
        error: "Distributed transaction name must be a string.",
      };
    }
    if (name.indexOf("'") !== -1) {
      return {
        valid: false,
        error: "Distributed transaction name cannot contain single quotes.",
      };
    }
    return { valid: true };
  }

  #connecting(): number {
    const connections = this.connections;
    let connecting = 0;
    for (let i = 0; i < connections.length; i++) {
      if (connections[i].state === PooledConnectionState.connecting) {
        connecting++;
      }
    }
    return connecting;
  }

  #dialForQueued() {
    const wanted = this.queue.length;
    if (wanted === 0) {
      return;
    }
    const connections = this.connections;
    let connecting = this.#connecting();
    while (connecting < wanted && connections.length < this.connectionInfo.max && this.#closing === null) {
      if (this.#adopt()) {
        // it has served the queue and dialed for the rest
        return;
      }
      const connection = this.createPooledConnection();
      connections.push(connection);
      connecting++;
      connection.dial();
    }
  }

  /// bun --hot: instead of a dial, an idle connection of a pool that an earlier load made with the same settings.
  #adopt(): boolean {
    const generation = this.generation;
    if (generation <= 0 || generation !== hotReloadGeneration()) {
      return false;
    }
    let predecessor = false;
    // The newest first: an older one may be a pool that the program kept.
    const pools = Array.from(hotPools);
    for (let i = pools.length - 1; i >= 0; i--) {
      const pool = pools[i];
      if (pool.generation === generation || !sameSettings(pool, this)) {
        continue;
      }
      predecessor = true;
      for (const connection of pool.readyConnections) {
        if (connection.queryCount === 0 && connection.connection.inTransaction !== true) {
          pool.connections.splice(pool.connections.indexOf(connection), 1);
          pool.readyConnections.delete(connection);
          connection.moveTo(this);
          this.connections.push(connection);
          this.connectionOpened(connection);
          return true;
        }
      }
    }
    if (!predecessor && this.connections.length === 0) {
      retireReplacedPools(generation);
    }
    return false;
  }

  /// What is idle closes now, what is busy when it is idle. The pool goes on: it dials when it is asked.
  retire() {
    const connections = this.connections.slice();
    for (let i = 0; i < connections.length; i++) {
      connections[i].retire();
    }
  }

  /// The ready connection that runs the fewest queries, if fewer than `limit`. The `setAside` that will be
  /// idle first are left to the reservations that wait ahead of the caller.
  #leastBusy(limit: number, setAside: number): PooledConnection | null {
    let found: PooledConnection | undefined;
    if (setAside === 0) {
      for (const connection of this.readyConnections) {
        if (found === undefined || connection.queryCount < found.queryCount) {
          found = connection;
        }
      }
    } else {
      found = Array.from(this.readyConnections).sort(idleFirst)[setAside];
    }
    return found !== undefined && found.queryCount < limit ? found : null;
  }

  /// Serves the oldest caller that can be served now. It is booked before it is called: it can re-enter the pool.
  /// `size`: how many connections the pool counts on.
  #serveNext(size: number): boolean {
    const queue = this.queue;
    let reservationsAhead = 0;
    for (let i = 0; i < queue.length; i++) {
      const waiter = queue[i];
      if (typeof waiter === "function") {
        // An even share of the demand over `size` connections: what is above it gets a new connection.
        // Below `max` the reservations ahead get a new one too, in a full pool one has to drain for each.
        const connection = this.#leastBusy(
          Math.ceil((queue.length + this.totalQueries) / size),
          this.connections.length < this.connectionInfo.max ? 0 : reservationsAhead,
        );
        if (connection === null) {
          return false;
        }
        queue.splice(i, 1);
        connection.queryCount++;
        this.totalQueries++;
        waiter(null, connection);
        return true;
      }
      const connection = reservationsAhead++ === 0 ? this.#leastBusy(1, 0) : null;
      if (connection !== null) {
        queue.splice(i, 1);
        connection.flags |= PooledConnectionFlags.reserved;
        connection.queryCount++;
        this.totalQueries++;
        this.readyConnections.delete(connection);
        connection.connection.hold();
        waiter.onConnected(null, connection);
        return true;
      }
    }
    return false;
  }

  #serve() {
    while (this.#serveNext(this.connectionInfo.max));
    this.#dialForQueued();
  }

  /// `prepared`: a distributed transaction ended with its PREPARE.
  release(connection: PooledConnection, prepared: boolean = false) {
    connection.queryCount--;
    this.totalQueries--;
    const reserved = connection.flags & PooledConnectionFlags.reserved;
    if (reserved) {
      connection.flags &= ~PooledConnectionFlags.reserved;
      // closes a connection whose maxLifetime ran out
      connection.connection.unhold();
    }
    if (this.#closeIfDrained() || connection.state !== PooledConnectionState.open) {
      return;
    }
    if (prepared) {
      connection.flags |= PooledConnectionFlags.prepared;
    }
    // On a pool of one connection a transaction by hand is in order, see checkUnsafeTransaction().
    if (reserved || this.connectionInfo.max !== 1) {
      if (connection.connection.inTransaction !== true) {
        connection.flags &= ~PooledConnectionFlags.prepared;
      } else if (!(connection.flags & PooledConnectionFlags.prepared)) {
        // Nobody gets the transaction that it was left in. What already runs behind may end it.
        this.readyConnections.delete(connection);
        if (connection.queryCount === 0) {
          connection.retire();
        }
        return;
      }
    }
    if (connection.flags & PooledConnectionFlags.retiring) {
      connection.retire();
      return;
    }
    this.readyConnections.add(connection);
    this.#serve();
  }

  connectionOpened(connection: PooledConnection) {
    this.readyConnections.add(connection);
    this.runUserCallback(this.connectionInfo.onconnect, null);
    this.#serve();
  }

  connectionClosed(connection: PooledConnection, err: Error, established: boolean) {
    const connections = this.connections;
    connections.splice(connections.indexOf(connection), 1);
    this.readyConnections.delete(connection);
    const closeHandlers = connection.closeHandlers;
    for (const onClose of closeHandlers) {
      onClose(err);
    }
    closeHandlers.clear();

    const waiting = this.queue.length;
    if (this.#tornDown) {
      if (!established) {
        return;
      }
    } else if (waiting > 0) {
      // They never used `connection`. After one that worked they get a new one.
      if (established) {
        this.#serve();
      } else {
        // The queries make do with the connections that are up. The oldest caller that none of them and no dial
        // on its way can take has its answer. The next one is dialed for while the server is known to answer.
        while (this.#serveNext(this.readyConnections.size));
        if (this.queue.length > this.#connecting()) {
          this.#failQueued(err, 1);
        }
        if (this.isConnected()) {
          this.#dialForQueued();
        }
      }
      if (connections.length === 0) {
        this.#failQueued(err, this.queue.length);
      }
      this.#closeIfDrained();
    }
    this.runUserCallback(this.connectionInfo.onclose, err);
  }

  #failQueued(err: Error, oldest: number) {
    const failed = this.queue.splice(0, oldest);
    for (let i = 0; i < failed.length; i++) {
      const waiter = failed[i];
      (typeof waiter === "function" ? waiter : waiter.onConnected)(err, null);
    }
  }

  isConnected() {
    const connections = this.connections;
    for (let i = 0; i < connections.length; i++) {
      if (connections[i].state === PooledConnectionState.open) {
        return true;
      }
    }
    return false;
  }
  flush() {
    const connections = this.connections;
    for (let i = 0; i < connections.length; i++) {
      if (connections[i].state === PooledConnectionState.open) {
        connections[i].flush();
      }
    }
  }

  #closeIfDrained(): boolean {
    if (this.#closing !== null && this.queue.length === 0 && this.totalQueries === 0) {
      this.#teardown();
    }
    return this.#tornDown;
  }

  #teardown() {
    if (this.#tornDown) {
      return;
    }
    this.#tornDown = true;
    const timers = this.#closeTimers;
    for (let i = 0; i < timers.length; i++) {
      clearTimeout(timers[i]);
    }
    timers.length = 0;
    this.#failQueued(this.connectionClosedError(), this.queue.length);
    const connections = this.connections.slice();
    for (let i = 0; i < connections.length; i++) {
      connections[i].destroy();
    }
    hotPools.delete(this);
    this.#closing!.resolve();
  }

  static #closeTimerFired(self: BaseSQLAdapter<any, any, any>) {
    self.#teardown();
  }

  /** Runs from close() after `closed` is set; overridden by Postgres for its LISTEN connection. */
  protected closeDedicatedConnections(): void {}

  /// Every call waits for the same teardown. A timeout, of whichever call, can only bring it forward.
  async close(options?: { timeout?: number }): Promise<void> {
    const timeout = closeTimeoutMs(options);
    if (this.#closing === null) {
      this.#closing = Promise.withResolvers<void>();
      this.closeDedicatedConnections();
      this.#closeIfDrained();
    }
    if (timeout === 0) {
      this.#teardown();
    } else if (timeout !== undefined && !this.#tornDown) {
      const timer = setTimeout(BaseSQLAdapter.#closeTimerFired, timeout, this);
      timer.unref(); // dont block the event loop
      this.#closeTimers.push(timer);
    }
    return this.#closing.promise;
  }

  /**
   * @param {function} onConnected - The callback function to be called when the connection is established.
   * @param {boolean} reserved - Whether the connection is reserved, if is reserved the connection will not be released until release is called, if not release will only decrement the queryCount counter
   */
  connect(onConnected: OnConnected, reserved: boolean = false) {
    if (this.#closing !== null) {
      return onConnected(this.connectionClosedError(), null);
    }
    this.queue.push(reserved ? new Reservation(onConnected) : onConnected);
    this.#serve();
  }
}

export default {
  BasePooledConnection,
  BaseSQLAdapter,
  closeTimeoutMs,
  createPooledConnectionHandle,
  sameSettings,
};
