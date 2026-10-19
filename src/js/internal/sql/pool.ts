import type { SSLMode } from "./options";
import type { Query as QueryType } from "./query";
import type { ArrayType, DatabaseAdapter, SQLArrayParameter, TransactionCommands } from "./shared";

type SQLResultArray<T> = import("./shared").SQLResultArray<T>;

const {
  SQLQueryFlags,
  onQuerySettled,
  symbols: { _results },
} = require("internal/sql/query");
const { SQLDialect, SQLResultArray, isUnsafeTransactionStart } = require("internal/sql/shared");
const AsyncContextFrame = require("internal/async_context_frame");
const { isStoppedModuleGraphRunning } = require("internal/shared");
const monotonicNowMs = $bindgen("Timer.bind.ts", "monotonicNowMs");
/// how many times `bun --hot` has reloaded the program, -1 without --hot
const hotReloadGeneration = $bindgen("jsc_hooks.bind.ts", "hotReloadGeneration");

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
export type { PooledConnection };

interface NativeConnection {
  close(): void;
  flush(): void;
  hold(): void;
  unhold(): void;
  /// a boolean: the server's word after its last complete reply
  readonly inTransaction: unknown;
  /// PostgreSQL, a boolean: the server asked for SASL in the login that is under way or was refused
  readonly sasl?: unknown;
}

/// A driver ignores the trailing arguments it does not take.
export type NativeCreateConnection<ConnectionHandle> = (
  hostname: string | undefined,
  port: number,
  username: string,
  password: string,
  database: string,
  sslmode: SSLMode,
  tls: Bun.TLSOptions | true | null, // true: an empty TLSOptions
  query: string,
  path: string,
  onConnected: (err: Error | null, connection: ConnectionHandle) => void,
  onDisconnected: (err: Error | null) => void,
  idleTimeout: number,
  connectionTimeout: number,
  maxLifetime: number,
  useUnnamedPreparedStatements: boolean,
  allowPublicKeyRetrieval: boolean,
  onRetire: (() => void) | undefined,
  foundRows: boolean,
  channelBinding: 0 | 1 | 2,
  columnTransform: ((name: string) => string) | undefined,
  scramPassword: string,
) => ConnectionHandle;

export type NativeCreateQuery<QueryHandle> = (
  sql: string,
  values: unknown[],
  pendingValue: SQLResultArray<unknown>,
  bigint: boolean,
  simple: boolean,
) => QueryHandle;

type OnConnected = (err: Error | null, connection: any) => void;

/// In the pool's queue: a caller that wants a connection for itself. A query is queued as its bare callback.
class Reservation {
  onConnected: OnConnected;
  constructor(onConnected: OnConnected) {
    this.onConnected = onConnected;
  }
}

/// connecting -> open -> closed, never back: whatever still holds a closed one cannot reach the one that replaced it.
class PooledConnection<ConnectionHandle extends NativeConnection = any> {
  adapter: BaseSQLAdapter<ConnectionHandle, any>;
  connection: ConnectionHandle | null = null;
  state: PooledConnectionState = PooledConnectionState.connecting;
  closeHandlers: Set<(err: Error) => void> = new Set();
  flags: number = 0;
  /// queryCount is used to indicate the number of queries using the connection, if a connection is reserved or if its a transaction queryCount will be 1 independently of the number of queries
  queryCount: number = 0;
  connectStartedAt: number = monotonicNowMs();
  connectAttempts: number = 0;
  retryTimer: ReturnType<typeof setTimeout> | null = null;
  saslprep: boolean;
  otherPassword: boolean | undefined;
  #releaseQuery: () => void;

  constructor(adapter: BaseSQLAdapter<ConnectionHandle, any>) {
    this.adapter = adapter;
    this.saslprep = adapter.saslprep === true;
    this.#releaseQuery = adapter.release.bind(adapter, this);
  }

  async #startConnection() {
    const adapter = this.adapter;
    this.connection = await createPooledConnectionHandle(
      adapter.createNativeConnection,
      adapter.connectionInfo,
      adapter.ownerCallback(this.#handleConnected.bind(this)),
      adapter.ownerCallback(this.#handleClose.bind(this)),
      adapter.ownerCallback(this.#handleRetire.bind(this)),
      this,
    );
  }

  /// Connect failures (ERR_*_CONNECTION_FAILED) mean the server accepted the TCP connection but closed it before
  /// the handshake completed, typically because it is still starting up or an intermediary (like a container port
  /// proxy) is up before the database is. Those are retried until connectionTimeout elapses, as long as queries
  /// are waiting on the pool. Refused connections (ERR_*_CONNECTION_REFUSED) fail fast: nothing is listening, and
  /// probes/healthchecks rely on the immediate error. Real server errors (authentication, errors during the
  /// handshake) and closes of established connections are not retried here.
  #isConnectFailure(err: Error | null): boolean {
    const adapter = this.adapter;
    return err instanceof adapter.ErrorClass && (err as any).code === adapter.codePrefix + "CONNECTION_FAILED";
  }

  /// The pool calls it once the connection is in `connections`: a function-valued password is user code.
  async dial() {
    try {
      await this.adapter.runAsOwner(this.#startConnection, this);
    } catch (err) {
      // nothing was dialed: the password function threw, or an option is refused
      this.#handleClose(err as Error);
    }
    if (this.state === PooledConnectionState.closed) {
      this.connection?.close();
      this.connection = null;
    }
  }

  #handleConnected(_err: Error | null, connection: ConnectionHandle) {
    if (this.state !== PooledConnectionState.connecting) {
      return;
    }
    this.connection = connection;
    this.state = PooledConnectionState.open;
    this.adapter.connectionOpened(this);
  }

  #handleClose(err: Error | null) {
    if (this.state === PooledConnectionState.closed) {
      return;
    }
    const connection = this.connection;
    this.connection = null;
    if (this.state === PooledConnectionState.connecting && tryOtherPassword(this, err, connection)) {
      this.dial();
      return;
    }
    if (this.state === PooledConnectionState.connecting && this.#isConnectFailure(err) && this.#canKeepRetrying()) {
      const delay = Math.min(20 * 2 ** ++this.connectAttempts, 1000);
      this.retryTimer = setTimeout(PooledConnection.#retryTimerFired, delay, this, err);
      return;
    }
    this.#finishClose(err);
  }

  /// maxLifetime ran out while it was busy. The native connection closes itself when it is idle.
  #handleRetire() {
    if (this.state !== PooledConnectionState.open) {
      return;
    }
    this.flags |= PooledConnectionFlags.retiring;
    this.adapter.readyConnections.delete(this);
  }

  retire() {
    this.#handleRetire();
    if (this.queryCount === 0) {
      this.close();
    }
  }

  /// bun --hot: `adapter` replaced the pool that dialed it.
  moveTo(adapter: BaseSQLAdapter<ConnectionHandle, any>) {
    this.adapter = adapter;
    this.#releaseQuery = adapter.release.bind(adapter, this);
  }

  static #retryTimerFired(self: PooledConnection, err: Error | null) {
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
    const connectionTimeout = $getByIdDirect(adapter.connectionInfo, "connectionTimeout") ?? 30 * 1000;
    return connectionTimeout > 0 && monotonicNowMs() - this.connectStartedAt < connectionTimeout;
  }

  #finishClose(err: Error | null) {
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

function idleFirst(a: PooledConnection, b: PooledConnection) {
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

function sameSettings(a: BaseSQLAdapter<any, any>, b: BaseSQLAdapter<any, any>): boolean {
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
  return $getByIdDirect(x, "transform")?.column.from === $getByIdDirect(y, "transform")?.column.from;
}

/// bun --hot only. This module and the open connections outlive a reload, the `new SQL()` of the program does not.
/// A pool leaves when its last connection has closed, so that it can be collected, and comes back when it dials.
const hotPools = new Set<BaseSQLAdapter<any, any>>();
let sweptGeneration = 0;

/// At the first dial of a load: a pool of an earlier load that nobody has asked for a connection since the first
/// dial of the load before is one that the program did not keep.
function retireUnusedPools(generation: number) {
  sweptGeneration = generation;
  for (const pool of hotPools) {
    if (pool.generation !== generation) {
      if (!pool.asked) {
        pool.retire();
        hotPools.delete(pool);
      }
      pool.asked = false;
    }
  }
}

function saslprep(password: string): string {
  return password
    .replace(/[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000]/g, " ")
    .replace(/\u034f|\u200d|[\ufe00-\ufe0f]|[\u00ad\u1806\u180b-\u180d\u200c\u2060\ufeff]/g, "")
    .normalize("NFKC");
}

/// The server made its SCRAM verifier from SASLprep(password) (RFC 4013), or from the password as it is when it
/// refused to prepare that. Which, only the server knows.
interface Login {
  saslprep: boolean;
  /// undefined before the first dial: whether the other one is another string that was not tried
  otherPassword?: boolean;
}

/// Whether to dial once more after `err`, which closed `connection`. The other methods send the password as it is.
function tryOtherPassword(login: Login, err: Error | null, connection: Pick<NativeConnection, "sasl"> | null): boolean {
  if (!login.otherPassword || (err as any)?.errno !== "28P01" || connection?.sasl !== true) {
    return false;
  }
  login.otherPassword = false;
  login.saslprep = !login.saslprep;
  return true;
}

/**
 * Resolves the password (which may be a function and/or a promise) and calls
 * the driver's native createConnection with the normalized pool options.
 */
async function createPooledConnectionHandle<ConnectionHandle>(
  nativeCreateConnection: NativeCreateConnection<ConnectionHandle>,
  options: Bun.SQL.__internal.DefinedPostgresOrMySQLOptions,
  onConnected: (err: Error | null, connection: ConnectionHandle) => void,
  onClose: (err: Error | null) => void,
  onRetire: (() => void) | undefined,
  login: Login & { state?: PooledConnectionState },
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
    // Not what `Object.prototype` has for a key that is not set.
  } = { __proto__: null, ...options } as unknown as typeof options;

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
  if (login.state === PooledConnectionState.closed) return null;

  password = String(password || "");
  const prepared = saslprep(password);
  login.otherPassword ??= options.adapter === "postgres" && prepared !== password;

  return nativeCreateConnection(
    hostname,
    Number(port),
    username || "",
    password,
    database || "",
    sslMode,
    (tls || null) as Bun.TLSOptions | true | null,
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
    login.saslprep ? prepared : password,
  );
}

/// A result of several: CALL <proc>() and a text of several statements.
function addResult(query: QueryType<any, any>, result: SQLResultArray<unknown>) {
  const results = query[_results];
  if (!results) {
    query[_results] = result;
  } else if (SQLResultArray.isResult(results)) {
    query[_results] = [results, result];
  } else {
    results.push(result);
  }
}

function onRejectQuery(query: QueryType<any, any>, err: Error) {
  query.reject(err);
}

abstract class BaseSQLAdapter<ConnectionHandle extends NativeConnection, QueryHandle>
  extends SQLDialect
  implements DatabaseAdapter<PooledConnection, ConnectionHandle, QueryHandle>
{
  public readonly connectionInfo: Bun.SQL.__internal.DefinedPostgresOrMySQLOptions;
  public readonly supportsReservedConnections = true;

  abstract readonly createNativeConnection: NativeCreateConnection<ConnectionHandle>;
  protected abstract readonly createNativeQuery: NativeCreateQuery<QueryHandle>;
  abstract readonly ErrorClass: new (message: string, options: { code: string }) => Error;
  /// ERR_POSTGRES_ or ERR_MYSQL_
  abstract readonly codePrefix: string;
  protected abstract readonly commitPrepared: string;
  protected abstract readonly rollbackPrepared: string;

  /// Every connection that is connecting or open. One enters before it dials and leaves when it closes.
  public readonly connections: PooledConnection[] = [];
  public readonly readyConnections: Set<PooledConnection> = new Set();

  public queue: Array<OnConnected | Reservation> = [];

  public totalQueries: number = 0;
  /// Which form of the password logged in last, see Login. undefined: none has yet.
  public saslprep: boolean | undefined;
  /// One login is finding out which form the server has. Nothing else is dialed until it has settled.
  #dialsHeld = false;
  /// The most connections it has had open at once since a dial last failed, when that was, and how often it has
  /// asked for one more since the last login, see #dialForQueued().
  #most = 0;
  #refusedAt = -Infinity;
  #tries = 0;
  public readonly generation: number = hotReloadGeneration();
  /// see retireUnusedPools()
  public asked: boolean = false;
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
    super();
    this.connectionInfo = connectionInfo;
    this.ownerGraphFrame = AsyncContextFrame.currentGraphFrame();
    this.callbackAsyncContext =
      $getByIdDirect(connectionInfo, "onconnect") || $getByIdDirect(connectionInfo, "onclose")
        ? AsyncContextFrame.current()
        : undefined;
    if (this.generation !== -1) {
      hotPools.add(this);
    }
  }

  get closed(): boolean {
    return this.#closing !== null;
  }

  /// close({ timeout: 0 }) was called: the caller gave up on what is queued.
  public closedAtOnce: boolean = false;

  abstract array(values: any[], typeNameOrID?: number | ArrayType): SQLArrayParameter;
  abstract getDistributedTransactionCommands(name: string): TransactionCommands | null;

  error(code: string, message: string) {
    return new this.ErrorClass(message, { code: this.codePrefix + code });
  }

  createQueryHandle(sql: string, values: unknown[], flags: number) {
    if (
      !(flags & SQLQueryFlags.allowUnsafeTransaction) &&
      this.connectionInfo.max !== 1 &&
      isUnsafeTransactionStart(sql)
    ) {
      throw this.error("UNSAFE_TRANSACTION", "Only use sql.begin, sql.reserved or max: 1");
    }
    // sql.unsafe(text, 0): parts.map(sql.unsafe) passes the index
    if (!values) {
      values = [];
      flags |= SQLQueryFlags.simple;
    }
    return this.createNativeQuery(
      sql,
      values,
      new SQLResultArray(),
      !!(flags & SQLQueryFlags.bigint),
      !!(flags & SQLQueryFlags.simple),
    );
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

  /// The name goes between single quotes.
  protected checkDistributedName(name: string): void {
    if (typeof name !== "string") {
      throw new Error("Distributed transaction name must be a string.");
    }
    if (name.includes("'")) {
      throw new Error("Distributed transaction name cannot contain single quotes.");
    }
  }

  getFinishDistributedSQL(commit: boolean, name: string): string {
    this.checkDistributedName(name);
    return `${commit ? this.commitPrepared : this.rollbackPrepared} '${name}'`;
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

  /// For the callers that wait. If no connection is ready, the pool is started: it dials until `max` is reached.
  /// Otherwise it grows by one dial for each waiting caller that no dial in flight covers: back to what it has had
  /// since a dial last failed, and by one more 20 ms after that, a pause that doubles with each such try, up to 1 s.
  /// A login ends it.
  #dialForQueued() {
    if (this.queue.length !== 0) {
      this.#dial(this.readyConnections.size === 0);
    }
  }

  #dial(start: boolean) {
    const connections = this.connections;
    const pause = Math.min(20 * 2 ** this.#tries, 1000);
    const limit = start ? 0 : this.#most + (monotonicNowMs() - this.#refusedAt < pause ? 0 : 1);
    while (
      !this.#dialsHeld &&
      connections.length < this.connectionInfo.max &&
      this.#closing === null &&
      (start || (connections.length < limit && this.#connecting() < this.queue.length))
    ) {
      if (!this.#adopt()) {
        const connection = new PooledConnection(this);
        connections.push(connection);
        if (!start && connections.length > this.#most) {
          this.#tries++;
        }
        connection.dial();
        if (connection.otherPassword === true && this.saslprep === undefined) {
          this.#dialsHeld = true;
        }
      }
    }
  }

  /// bun --hot: instead of a dial, an idle connection of a pool that an earlier load made with the same settings.
  #adopt(): boolean {
    const generation = this.generation;
    if (generation !== -1) {
      hotPools.add(this);
    }
    if (generation <= 0 || generation !== hotReloadGeneration()) {
      return false;
    }
    if (sweptGeneration !== generation) {
      retireUnusedPools(generation);
    }
    // The newest first: an older one may be a pool that the program kept.
    const pools = Array.from(hotPools);
    for (let i = pools.length - 1; i >= 0; i--) {
      const pool = pools[i];
      if (pool.generation === generation || !sameSettings(pool, this)) {
        continue;
      }
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
  #serveNext(): boolean {
    const queue = this.queue;
    let reservationsAhead = 0;
    // Behind as many reservations as there are connections nobody can be served.
    for (let i = 0; i < queue.length && reservationsAhead < this.connections.length; i++) {
      const waiter = queue[i];
      if (typeof waiter === "function") {
        // An even share of the demand over `max` connections.
        // A reservation ahead gets a dial that is on its way, or one connection has to drain for it.
        const connection = this.#leastBusy(
          Math.ceil((queue.length + this.totalQueries) / this.connectionInfo.max),
          reservationsAhead && Math.max(reservationsAhead - this.#connecting(), 0),
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
    while (this.#serveNext());
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
    // On a pool of one connection a transaction by hand is in order, see createQueryHandle().
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
    this.saslprep = connection.saslprep;
    this.#most = Math.max(this.#most, this.connections.length - this.#connecting());
    this.#tries = 0;
    this.#refusedAt = -Infinity;
    this.readyConnections.add(connection);
    if (this.#dialsHeld) {
      this.#dialsHeld = false;
      this.#dial(true);
    }
    this.runUserCallback($getByIdDirect(this.connectionInfo, "onconnect"), null);
    this.#serve();
    // The server has room: the callers that still wait do not have to wait for the next one to arrive. One more
    // connection, not a start: a reservation that has just taken this one leaves nothing ready.
    if (this.queue.length !== 0) {
      this.#dial(false);
    }
  }

  connectionClosed(connection: PooledConnection, err: Error, established: boolean) {
    const connections = this.connections;
    connections.splice(connections.indexOf(connection), 1);
    if (connections.length === 0) {
      hotPools.delete(this);
      this.#dialsHeld = false;
    }
    this.readyConnections.delete(connection);
    if (!established) {
      this.#most = connections.length - this.#connecting();
      this.#refusedAt = monotonicNowMs();
    }
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
      // They never used `connection`. If it was established, they get a new one. A failed dial rejects them only
      // when the pool has no connection left.
      if (established) {
        this.#serve();
        this.#dialForQueued();
      }
      if (connections.length === 0) {
        this.#failQueued(err);
      }
      this.#closeIfDrained();
    }
    this.runUserCallback($getByIdDirect(this.connectionInfo, "onclose"), err);
  }

  #failQueued(err: Error) {
    const failed = this.queue.splice(0);
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
    this.#failQueued(this.connectionClosedError());
    const connections = this.connections.slice();
    for (let i = 0; i < connections.length; i++) {
      connections[i].destroy();
    }
    this.#closing!.resolve();
  }

  static #closeTimerFired(self: BaseSQLAdapter<any, any>) {
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
      this.closedAtOnce = true;
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
    this.asked = true;
    this.queue.push(reserved ? new Reservation(onConnected) : onConnected);
    this.#serve();
    this.#dialForQueued();
  }
}

export default {
  BaseSQLAdapter,
  addResult,
  onRejectQuery,
  closeTimeoutMs,
  createPooledConnectionHandle,
  sameSettings,
  tryOtherPassword,
};
