const { hideFromStack } = require("internal/shared");

const enum QueryStatus {
  active = 1 << 1,
  cancelled = 1 << 2,
  error = 1 << 3,
  executed = 1 << 4,
}
const cmds = ["", "INSERT", "DELETE", "UPDATE", "MERGE", "SELECT", "MOVE", "FETCH", "COPY"];

const PublicArray = globalThis.Array;
const enum SSLMode {
  disable = 0,
  prefer = 1,
  require = 2,
  verify_ca = 3,
  verify_full = 4,
}

function connectionClosedError() {
  return $ERR_POSTGRES_CONNECTION_CLOSED("Connection closed");
}
hideFromStack(connectionClosedError);

class SQLResultArray extends PublicArray {
  static [Symbol.toStringTag] = "SQLResults";

  statement;
  command;
  count;
}

const rawMode_values = 1;
const rawMode_objects = 2;

const _resolve = Symbol("resolve");
const _reject = Symbol("reject");
const _handle = Symbol("handle");
const _run = Symbol("run");
const _queryStatus = Symbol("status");
const _handler = Symbol("handler");
const PublicPromise = Promise;
type TransactionCallback = (sql: (strings: string, ...values: any[]) => Query) => Promise<any>;

const {
  createConnection: _createConnection,
  createQuery,
  PostgresSQLConnection,
  init,
} = $zig("postgres.zig", "createBinding");

function normalizeSSLMode(value: string): SSLMode {
  if (!value) {
    return SSLMode.disable;
  }

  value = (value + "").toLowerCase();
  switch (value) {
    case "disable":
      return SSLMode.disable;
    case "prefer":
      return SSLMode.prefer;
    case "require":
      return SSLMode.require;
    case "verify-ca":
    case "verify_ca":
      return SSLMode.verify_ca;
    case "verify-full":
    case "verify_full":
      return SSLMode.verify_full;
    default: {
      break;
    }
  }

  throw $ERR_INVALID_ARG_VALUE("sslmode", value);
}

class Query extends PublicPromise {
  [_resolve];
  [_reject];
  [_handle];
  [_handler];
  [_queryStatus] = 0;

  [Symbol.for("nodejs.util.inspect.custom")]() {
    const status = this[_queryStatus];
    const active = (status & QueryStatus.active) != 0;
    const cancelled = (status & QueryStatus.cancelled) != 0;
    const executed = (status & QueryStatus.executed) != 0;
    const error = (status & QueryStatus.error) != 0;
    return `PostgresQuery { ${active ? "active" : ""} ${cancelled ? "cancelled" : ""} ${executed ? "executed" : ""} ${error ? "error" : ""} }`;
  }

  constructor(handle, handler) {
    var resolve_, reject_;
    super((resolve, reject) => {
      resolve_ = resolve;
      reject_ = reject;
    });
    this[_resolve] = resolve_;
    this[_reject] = reject_;
    this[_handle] = handle;
    this[_handler] = handler;
    this[_queryStatus] = handle ? 0 : QueryStatus.cancelled;
  }

  async [_run]() {
    const { [_handle]: handle, [_handler]: handler, [_queryStatus]: status } = this;

    if (status & (QueryStatus.executed | QueryStatus.error | QueryStatus.cancelled)) {
      return;
    }

    this[_queryStatus] |= QueryStatus.executed;
    // this avoids a infinite loop
    await 1;
    return handler(this, handle);
  }

  get active() {
    return (this[_queryStatus] & QueryStatus.active) != 0;
  }

  set active(value) {
    const status = this[_queryStatus];
    if (status & (QueryStatus.cancelled | QueryStatus.error)) {
      return;
    }

    if (value) {
      this[_queryStatus] |= QueryStatus.active;
    } else {
      this[_queryStatus] &= ~QueryStatus.active;
    }
  }

  get cancelled() {
    return (this[_queryStatus] & QueryStatus.cancelled) !== 0;
  }

  resolve(x) {
    this[_queryStatus] &= ~QueryStatus.active;
    this[_handle].done();
    return this[_resolve](x);
  }

  reject(x) {
    this[_queryStatus] &= ~QueryStatus.active;
    this[_queryStatus] |= QueryStatus.error;
    this[_handle].done();

    return this[_reject](x);
  }

  cancel() {
    var status = this[_queryStatus];
    if (status & QueryStatus.cancelled) {
      return this;
    }
    this[_queryStatus] |= QueryStatus.cancelled;

    if (status & QueryStatus.executed) {
      this[_handle].cancel();
    }

    return this;
  }

  execute() {
    this[_run]();
    return this;
  }

  raw() {
    this[_handle].raw = rawMode_objects;
    return this;
  }

  values() {
    this[_handle].raw = rawMode_values;
    return this;
  }

  then() {
    this[_run]();
    const result = super.$then.$apply(this, arguments);
    $markPromiseAsHandled(result);
    return result;
  }

  catch() {
    this[_run]();
    const result = super.catch.$apply(this, arguments);
    $markPromiseAsHandled(result);
    return result;
  }

  finally() {
    this[_run]();
    return super.finally.$apply(this, arguments);
  }
}
Object.defineProperty(Query, Symbol.species, { value: PublicPromise });
Object.defineProperty(Query, Symbol.toStringTag, { value: "Query" });
init(
  function onResolvePostgresQuery(query, result, commandTag, count, queries) {
    $assert(result instanceof SQLResultArray, "Invalid result array");
    if (typeof commandTag === "string") {
      if (commandTag.length > 0) {
        result.command = commandTag;
      }
    } else {
      result.command = cmds[commandTag];
    }

    result.count = count || 0;

    if (queries) {
      const queriesIndex = queries.indexOf(query);
      if (queriesIndex !== -1) {
        queries.splice(queriesIndex, 1);
      }
    }

    try {
      query.resolve(result);
    } catch (e) {}
  },
  function onRejectPostgresQuery(query, reject, queries) {
    if (queries) {
      const queriesIndex = queries.indexOf(query);
      if (queriesIndex !== -1) {
        queries.splice(queriesIndex, 1);
      }
    }

    try {
      query.reject(reject);
    } catch (e) {}
  },
);

function onQueryFinish(onClose) {
  this.queries.delete(onClose);
  this.pool.release(this);
}

enum PooledConnectionState {
  pending = 0,
  connected = 1,
  closed = 2,
}
enum PooledConnectionFlags {
  /// canBeConnected is used to indicate that at least one time we were able to connect to the database
  canBeConnected = 1 << 0,
  /// reserved is used to indicate that the connection is currently reserved
  reserved = 1 << 1,
  /// preReserved is used to indicate that the connection will be reserved in the future when queryCount drops to 0
  preReserved = 1 << 2,
}
class PooledConnection {
  pool: ConnectionPool;
  connection: ReturnType<typeof createConnection>;
  state: PooledConnectionState = PooledConnectionState.pending;
  storedError: Error | null = null;
  queries: Set<(err: Error) => void> = new Set();
  onFinish: ((err: Error | null) => void) | null = null;
  connectionInfo: any;

  flags: number = 0;
  /// queryCount is used to indicate the number of queries using the connection, if a connection is reserved or if its a transaction queryCount will be 1 independently of the number of queries
  queryCount: number = 0;
  #onConnected(err, _) {
    const connectionInfo = this.connectionInfo;
    if (connectionInfo?.onconnect) {
      connectionInfo.onconnect(err);
    }
    this.storedError = err;
    if (!err) {
      this.flags |= PooledConnectionFlags.canBeConnected;
    }
    this.state = err ? PooledConnectionState.closed : PooledConnectionState.connected;
    const onFinish = this.onFinish;
    if (onFinish) {
      this.queryCount = 0;
      this.flags &= ~PooledConnectionFlags.reserved;
      this.flags &= ~PooledConnectionFlags.preReserved;

      // pool is closed, lets finish the connection
      // pool is closed, lets finish the connection
      if (err) {
        onFinish(err);
      } else {
        this.connection.close();
      }
      return;
    }
    this.pool.release(this, true);
  }
  #onClose(err) {
    const connectionInfo = this.connectionInfo;
    if (connectionInfo?.onclose) {
      connectionInfo.onclose(err);
    }
    this.state = PooledConnectionState.closed;
    this.connection = null;
    this.storedError = err;

    // remove from ready connections if its there
    this.pool.readyConnections.delete(this);
    const queries = new Set(this.queries);
    this.queries.clear();
    this.queryCount = 0;
    this.flags &= ~PooledConnectionFlags.reserved;

    // notify all queries that the connection is closed
    for (const onClose of queries) {
      onClose(err);
    }
    const onFinish = this.onFinish;
    if (onFinish) {
      onFinish(err);
    }

    this.pool.release(this, true);
  }
  constructor(connectionInfo, pool: ConnectionPool) {
    this.connection = createConnection(connectionInfo, this.#onConnected.bind(this), this.#onClose.bind(this));
    this.state = PooledConnectionState.pending;
    this.pool = pool;
    this.connectionInfo = connectionInfo;
  }
  onClose(onClose: (err: Error) => void) {
    this.queries.add(onClose);
  }
  bindQuery(query: Query, onClose: (err: Error) => void) {
    this.queries.add(onClose);
    // @ts-ignore
    query.finally(onQueryFinish.bind(this, onClose));
  }
  #doRetry() {
    if (this.pool.closed) {
      return;
    }
    // reset error and state
    this.storedError = null;
    this.state = PooledConnectionState.pending;
    // retry connection
    this.connection = createConnection(
      this.connectionInfo,
      this.#onConnected.bind(this, this.connectionInfo),
      this.#onClose.bind(this, this.connectionInfo),
    );
  }
  close() {
    try {
      if (this.state === PooledConnectionState.connected) {
        this.connection?.close();
      }
    } catch {}
  }
  flush() {
    this.connection?.flush();
  }
  retry() {
    // if pool is closed, we can't retry
    if (this.pool.closed) {
      return false;
    }
    // we need to reconnect
    // lets use a retry strategy

    // we can only retry if one day we are able to connect
    if (this.flags & PooledConnectionFlags.canBeConnected) {
      this.#doRetry();
    } else {
      // analyse type of error to see if we can retry
      switch (this.storedError?.code) {
        case "ERR_POSTGRES_UNSUPPORTED_AUTHENTICATION_METHOD":
        case "ERR_POSTGRES_UNKNOWN_AUTHENTICATION_METHOD":
        case "ERR_POSTGRES_TLS_NOT_AVAILABLE":
        case "ERR_POSTGRES_TLS_UPGRADE_FAILED":
        case "ERR_POSTGRES_INVALID_SERVER_SIGNATURE":
        case "ERR_POSTGRES_INVALID_SERVER_KEY":
        case "ERR_POSTGRES_AUTHENTICATION_FAILED_PBKDF2":
          // we can't retry these are authentication errors
          return false;
        default:
          // we can retry
          this.#doRetry();
          return true;
      }
    }
  }
}
class ConnectionPool {
  connectionInfo: any;

  connections: PooledConnection[];
  readyConnections: Set<PooledConnection>;
  waitingQueue: Array<(err: Error | null, result: any) => void> = [];
  reservedQueue: Array<(err: Error | null, result: any) => void> = [];

  poolStarted: boolean = false;
  closed: boolean = false;
  onAllQueriesFinished: (() => void) | null = null;
  constructor(connectionInfo) {
    this.connectionInfo = connectionInfo;
    this.connections = new Array(connectionInfo.max);
    this.readyConnections = new Set();
  }

  flushConcurrentQueries() {
    if (this.waitingQueue.length === 0) {
      return;
    }
    while (this.waitingQueue.length > 0) {
      let endReached = true;
      // no need to filter for reserved connections because there are not in the readyConnections
      // preReserved only shows that we wanna avoiding adding more queries to it
      const nonReservedConnections = Array.from(this.readyConnections).filter(
        c => !(c.flags & PooledConnectionFlags.preReserved),
      );
      if (nonReservedConnections.length === 0) {
        return;
      }
      // kinda balance the load between connections
      const orderedConnections = nonReservedConnections.sort((a, b) => a.queryCount - b.queryCount);
      const leastQueries = orderedConnections[0].queryCount;

      for (const connection of orderedConnections) {
        if (connection.queryCount > leastQueries) {
          endReached = false;
          break;
        }

        const pending = this.waitingQueue.shift();
        if (pending) {
          connection.queryCount++;
          pending(null, connection);
        }
      }
      const halfPoolSize = Math.ceil(this.connections.length / 2);
      if (endReached || orderedConnections.length < halfPoolSize) {
        // we are able to distribute the load between connections but the connection pool is less than half of the pool size
        // so we can stop here and wait for the next tick to flush the waiting queue
        break;
      }
    }
    if (this.waitingQueue.length > 0) {
      // we still wanna to flush the waiting queue but lets wait for the next tick because some connections might be released
      // this is better for query performance
      process.nextTick(this.flushConcurrentQueries.bind(this));
    }
  }

  release(connection: PooledConnection, connectingEvent: boolean = false) {
    if (!connectingEvent) {
      connection.queryCount--;
    }
    const was_reserved = connection.flags & PooledConnectionFlags.reserved;
    connection.flags &= ~PooledConnectionFlags.reserved;
    connection.flags &= ~PooledConnectionFlags.preReserved;
    if (this.onAllQueriesFinished) {
      // we are waiting for all queries to finish, lets check if we can call it
      if (!this.hasPendingQueries()) {
        this.onAllQueriesFinished();
      }
    }
    if (connection.state !== PooledConnectionState.connected) {
      // connection is not ready
      return;
    }
    if (was_reserved) {
      if (this.waitingQueue.length > 0) {
        if (connection.storedError) {
          // this connection got a error but maybe we can wait for another

          if (this.hasConnectionsAvailable()) {
            return;
          }

          // we have no connections available so lets fails
          let pending;
          while ((pending = this.waitingQueue.shift())) {
            pending.onConnected(connection.storedError, connection);
          }
          return;
        }
        const pendingReserved = this.reservedQueue.shift();
        if (pendingReserved) {
          connection.flags |= PooledConnectionFlags.reserved;
          connection.queryCount++;
          // we have a connection waiting for a reserved connection lets prioritize it
          pendingReserved(connection.storedError, connection);
          return;
        }
        this.flushConcurrentQueries();
      } else {
        // connection is ready, lets add it back to the ready connections
        this.readyConnections.add(connection);
      }
    } else {
      if (connection.queryCount == 0) {
        // ok we can actually bind reserved queries to it
        const pendingReserved = this.reservedQueue.shift();
        if (pendingReserved) {
          connection.flags |= PooledConnectionFlags.reserved;
          connection.queryCount++;
          // we have a connection waiting for a reserved connection lets prioritize it
          pendingReserved(connection.storedError, connection);
          return;
        }
      }

      this.readyConnections.add(connection);

      this.flushConcurrentQueries();
    }
  }

  hasConnectionsAvailable() {
    if (this.readyConnections.size > 0) return true;
    if (this.poolStarted) {
      const pollSize = this.connections.length;
      for (let i = 0; i < pollSize; i++) {
        const connection = this.connections[i];
        if (connection.state !== PooledConnectionState.closed) {
          // some connection is connecting or connected
          return true;
        }
      }
    }
    return false;
  }
  hasPendingQueries() {
    if (this.waitingQueue.length > 0 || this.reservedQueue.length > 0) return true;
    if (this.poolStarted) {
      const pollSize = this.connections.length;
      for (let i = 0; i < pollSize; i++) {
        const connection = this.connections[i];
        if (connection.queryCount > 0) {
          return true;
        }
      }
    }
    return false;
  }
  isConnected() {
    if (this.readyConnections.size > 0) {
      return true;
    }
    if (this.poolStarted) {
      const pollSize = this.connections.length;
      for (let i = 0; i < pollSize; i++) {
        const connection = this.connections[i];
        if (connection.state === PooledConnectionState.connected) {
          return true;
        }
      }
    }
    return false;
  }
  flush() {
    if (this.closed) {
      return;
    }
    if (this.poolStarted) {
      const pollSize = this.connections.length;
      for (let i = 0; i < pollSize; i++) {
        const connection = this.connections[i];
        if (connection.state === PooledConnectionState.connected) {
          connection.connection.flush();
        }
      }
    }
  }

  async #close() {
    let pending;
    while ((pending = this.waitingQueue.shift())) {
      pending(connectionClosedError(), null);
    }
    while (this.reservedQueue.length > 0) {
      const pendingReserved = this.reservedQueue.shift();
      if (pendingReserved) {
        pendingReserved(connectionClosedError(), null);
      }
    }
    const promises: Array<Promise<any>> = [];
    if (this.poolStarted) {
      this.poolStarted = false;
      const pollSize = this.connections.length;
      for (let i = 0; i < pollSize; i++) {
        const connection = this.connections[i];
        switch (connection.state) {
          case PooledConnectionState.pending:
            {
              const { promise, resolve } = Promise.withResolvers();
              connection.onFinish = resolve;
              promises.push(promise);
            }
            break;
          case PooledConnectionState.connected:
            {
              const { promise, resolve } = Promise.withResolvers();
              connection.onFinish = resolve;
              promises.push(promise);
              connection.connection.close();
            }
            break;
        }
        // clean connection reference
        // @ts-ignore
        this.connections[i] = null;
      }
    }
    this.readyConnections.clear();
    this.waitingQueue.length = 0;
    return Promise.all(promises);
  }
  async close(options?: { timeout?: number }) {
    if (this.closed) {
      return Promise.reject(connectionClosedError());
    }
    let timeout = options?.timeout;
    if (timeout) {
      timeout = Number(timeout);
      if (timeout > 2 ** 31 || timeout < 0 || timeout !== timeout) {
        throw $ERR_INVALID_ARG_VALUE("options.timeout", timeout, "must be a non-negative integer less than 2^31");
      }
      this.closed = true;
      if (timeout > 0 && this.hasPendingQueries()) {
        const { promise, resolve } = Promise.withResolvers();
        const timer = setTimeout(() => {
          // timeout is reached, lets close and probably fail some queries
          this.#close().finally(resolve);
        }, timeout * 1000);
        timer.unref(); // dont block the event loop
        this.onAllQueriesFinished = () => {
          clearTimeout(timer);
          // everything is closed, lets close the pool
          this.#close().finally(resolve);
        };

        return promise;
      }
    } else {
      this.closed = true;
    }

    await this.#close();
  }

  /**
   * @param {function} onConnected - The callback function to be called when the connection is established.
   * @param {boolean} reserved - Whether the connection is reserved, if is reserved the connection will not be released until release is called, if not release will only decrement the queryCount counter
   */
  connect(onConnected: (err: Error | null, result: any) => void, reserved: boolean = false) {
    if (this.closed) {
      return onConnected(connectionClosedError(), null);
    }

    if (this.readyConnections.size === 0) {
      // no connection ready lets make some
      let retry_in_progress = false;
      let all_closed = true;
      let storedError: Error | null = null;

      if (this.poolStarted) {
        // we already started the pool
        // lets check if some connection is available to retry
        const pollSize = this.connections.length;
        for (let i = 0; i < pollSize; i++) {
          const connection = this.connections[i];
          // we need a new connection and we have some connections that can retry
          if (connection.state === PooledConnectionState.closed) {
            if (connection.retry()) {
              // lets wait for connection to be released
              if (!retry_in_progress) {
                // avoid adding to the queue twice, we wanna to retry every available pool connection
                retry_in_progress = true;
                if (reserved) {
                  // we are not sure what connection will be available so we dont pre reserve
                  this.reservedQueue.push(onConnected);
                } else {
                  this.waitingQueue.push(onConnected);
                }
              }
            } else {
              // we have some error, lets grab it and fail if unable to start a connection
              storedError = connection.storedError;
            }
          } else {
            // we have some pending or open connections
            all_closed = false;
          }
        }
        if (!all_closed && !retry_in_progress) {
          // is possible to connect because we have some working connections, or we are just without network for some reason
          // wait for connection to be released or fail
          if (reserved) {
            // we are not sure what connection will be available so we dont pre reserve
            this.reservedQueue.push(onConnected);
          } else {
            this.waitingQueue.push(onConnected);
          }
        } else {
          // impossible to connect or retry
          onConnected(storedError, null);
        }
        return;
      }
      // we never started the pool, lets start it
      if (reserved) {
        this.reservedQueue.push(onConnected);
      } else {
        this.waitingQueue.push(onConnected);
      }
      this.poolStarted = true;
      const pollSize = this.connections.length;
      // pool is always at least 1 connection
      this.connections[0] = new PooledConnection(this.connectionInfo, this);
      this.connections[0].flags |= PooledConnectionFlags.preReserved; // lets pre reserve the first connection
      for (let i = 1; i < pollSize; i++) {
        this.connections[i] = new PooledConnection(this.connectionInfo, this);
      }
      return;
    }
    if (reserved) {
      let connectionWithLeastQueries: PooledConnection | null = null;
      let leastQueries = Infinity;
      for (const connection of this.readyConnections) {
        if (connection.flags & PooledConnectionFlags.reserved || connection.flags & PooledConnectionFlags.preReserved)
          continue;
        const queryCount = connection.queryCount;
        if (queryCount > 0) {
          if (queryCount < leastQueries) {
            leastQueries = queryCount;
            connectionWithLeastQueries = connection;
            continue;
          }
        }
        connection.flags |= PooledConnectionFlags.reserved;
        connection.queryCount++;
        this.readyConnections.delete(connection);
        onConnected(null, connection);
        return;
      }
      if (connectionWithLeastQueries) {
        // lets mark the connection with the least queries as preReserved if any
        connectionWithLeastQueries.flags |= PooledConnectionFlags.preReserved;
      }
      // no connection available to be reserved lets wait for a connection to be released
      this.reservedQueue.push(onConnected);
    } else {
      this.waitingQueue.push(onConnected);
      this.flushConcurrentQueries();
    }
  }
}

function createConnection(
  {
    hostname,
    port,
    username,
    password,
    tls,
    query,
    database,
    sslMode,
    idleTimeout = 0,
    connectionTimeout = 30 * 1000,
    maxLifetime = 0,
  },
  onConnected,
  onClose,
) {
  return _createConnection(
    hostname,
    Number(port),
    username || "",
    password || "",
    database || "",
    // > The default value for sslmode is prefer. As is shown in the table, this
    // makes no sense from a security point of view, and it only promises
    // performance overhead if possible. It is only provided as the default for
    // backward compatibility, and is not recommended in secure deployments.
    sslMode || SSLMode.disable,
    tls || null,
    query || "",
    onConnected,
    onClose,
    idleTimeout,
    connectionTimeout,
    maxLifetime,
  );
}

var hasSQLArrayParameter = false;
function normalizeStrings(strings, values) {
  hasSQLArrayParameter = false;
  if ($isJSArray(strings)) {
    const count = strings.length;
    if (count === 0) {
      return "";
    }

    var out = strings[0];

    // For now, only support insert queries with array parameters
    //
    // insert into users ${sql(users)}
    //
    if (values.length > 0 && typeof values[0] === "object" && values[0] && values[0] instanceof SQLArrayParameter) {
      if (values.length > 1) {
        throw new Error("Cannot mix array parameters with other values");
      }
      hasSQLArrayParameter = true;
      const { columns, value } = values[0];
      const groupCount = value.length;
      out += `values `;

      let columnIndex = 1;
      let columnCount = columns.length;
      let lastColumnIndex = columnCount - 1;

      for (var i = 0; i < groupCount; i++) {
        out += i > 0 ? `, (` : `(`;

        for (var j = 0; j < lastColumnIndex; j++) {
          out += `$${columnIndex++}, `;
        }

        out += `$${columnIndex++})`;
      }

      for (var i = 1; i < count; i++) {
        out += strings[i];
      }

      return out;
    }

    for (var i = 1; i < count; i++) {
      out += `$${i}${strings[i]}`;
    }
    return out;
  }

  return strings + "";
}

class SQLArrayParameter {
  value: any;
  columns: string[];
  constructor(value, keys) {
    if (keys?.length === 0) {
      keys = Object.keys(value[0]);
    }

    for (let key of keys) {
      if (typeof key === "string") {
        const asNumber = Number(key);
        if (Number.isNaN(asNumber)) {
          continue;
        }
        key = asNumber;
      }

      if (typeof key !== "string") {
        if (Number.isSafeInteger(key)) {
          if (key >= 0 && key <= 64 * 1024) {
            continue;
          }
        }

        throw new Error(`Invalid key: ${key}`);
      }
    }

    this.value = value;
    this.columns = keys;
  }
}

function loadOptions(o) {
  var hostname,
    port,
    username,
    password,
    database,
    tls,
    url,
    query,
    adapter,
    idleTimeout,
    connectionTimeout,
    maxLifetime,
    onconnect,
    onclose,
    max;
  const env = Bun.env;
  var sslMode: SSLMode = SSLMode.disable;

  if (o === undefined || (typeof o === "string" && o.length === 0)) {
    let urlString = env.POSTGRES_URL || env.DATABASE_URL || env.PGURL || env.PG_URL;
    if (!urlString) {
      urlString = env.TLS_POSTGRES_DATABASE_URL || env.TLS_DATABASE_URL;
      if (urlString) {
        sslMode = SSLMode.require;
      }
    }

    if (urlString) {
      url = new URL(urlString);
      o = {};
    }
  } else if (o && typeof o === "object") {
    if (o instanceof URL) {
      url = o;
    } else if (o?.url) {
      const _url = o.url;
      if (typeof _url === "string") {
        url = new URL(_url);
      } else if (_url && typeof _url === "object" && _url instanceof URL) {
        url = _url;
      }
    }

    if (o?.tls) {
      sslMode = SSLMode.require;
      tls = o.tls;
    }
  } else if (typeof o === "string") {
    url = new URL(o);
  }

  if (url) {
    ({ hostname, port, username, password, adapter } = o);
    // object overrides url
    hostname ||= url.hostname;
    port ||= url.port;
    username ||= url.username;
    password ||= url.password;
    adapter ||= url.protocol;

    if (adapter[adapter.length - 1] === ":") {
      adapter = adapter.slice(0, -1);
    }

    const queryObject = url.searchParams.toJSON();
    query = "";
    for (const key in queryObject) {
      if (key.toLowerCase() === "sslmode") {
        sslMode = normalizeSSLMode(queryObject[key]);
      } else {
        query += `${encodeURIComponent(key)}=${encodeURIComponent(queryObject[key])} `;
      }
    }
    query = query.trim();
  }

  hostname ||= o.hostname || o.host || env.PGHOST || "localhost";
  port ||= Number(o.port || env.PGPORT || 5432);
  username ||= o.username || o.user || env.PGUSERNAME || env.PGUSER || env.USER || env.USERNAME || "postgres";
  database ||= o.database || o.db || (url?.pathname ?? "").slice(1) || env.PGDATABASE || username;
  password ||= o.password || o.pass || env.PGPASSWORD || "";
  tls ||= o.tls || o.ssl;
  adapter ||= o.adapter || "postgres";
  max = o.max;

  idleTimeout ??= o.idleTimeout;
  idleTimeout ??= o.idle_timeout;
  connectionTimeout ??= o.connectionTimeout;
  connectionTimeout ??= o.connection_timeout;
  maxLifetime ??= o.maxLifetime;
  maxLifetime ??= o.max_lifetime;

  onconnect ??= o.onconnect;
  onclose ??= o.onclose;
  if (onconnect !== undefined) {
    if (!$isCallable(onconnect)) {
      throw $ERR_INVALID_ARG_TYPE("onconnect", "function", onconnect);
    }
  }

  if (onclose !== undefined) {
    if (!$isCallable(onclose)) {
      throw $ERR_INVALID_ARG_TYPE("onclose", "function", onclose);
    }
  }

  if (idleTimeout != null) {
    idleTimeout = Number(idleTimeout);
    if (idleTimeout > 2 ** 31 || idleTimeout < 0 || idleTimeout !== idleTimeout) {
      throw $ERR_INVALID_ARG_VALUE(
        "options.idle_timeout",
        idleTimeout,
        "must be a non-negative integer less than 2^31",
      );
    }
  }

  if (connectionTimeout != null) {
    connectionTimeout = Number(connectionTimeout);
    if (connectionTimeout > 2 ** 31 || connectionTimeout < 0 || connectionTimeout !== connectionTimeout) {
      throw $ERR_INVALID_ARG_VALUE(
        "options.connection_timeout",
        connectionTimeout,
        "must be a non-negative integer less than 2^31",
      );
    }
  }

  if (maxLifetime != null) {
    maxLifetime = Number(maxLifetime);
    if (maxLifetime > 2 ** 31 || maxLifetime < 0 || maxLifetime !== maxLifetime) {
      throw $ERR_INVALID_ARG_VALUE(
        "options.max_lifetime",
        maxLifetime,
        "must be a non-negative integer less than 2^31",
      );
    }
  }

  if (max != null) {
    max = Number(max);
    if (max > 2 ** 31 || max < 1 || max !== max) {
      throw $ERR_INVALID_ARG_VALUE("options.max", max, "must be a non-negative integer between 1 and 2^31");
    }
  }

  if (sslMode !== SSLMode.disable && !tls?.serverName) {
    if (hostname) {
      tls = {
        serverName: hostname,
      };
    } else {
      tls = true;
    }
  }

  if (!!tls) {
    sslMode = SSLMode.prefer;
  }
  port = Number(port);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw $ERR_INVALID_ARG_VALUE("port", port, "must be a non-negative integer between 1 and 65535");
  }

  switch (adapter) {
    case "postgres":
    case "postgresql":
      adapter = "postgres";
      break;
    default:
      throw new Error(`Unsupported adapter: ${adapter}. Only \"postgres\" is supported for now`);
  }
  const ret: any = { hostname, port, username, password, database, tls, query, sslMode, adapter };
  if (idleTimeout != null) {
    ret.idleTimeout = idleTimeout;
  }
  if (connectionTimeout != null) {
    ret.connectionTimeout = connectionTimeout;
  }
  if (maxLifetime != null) {
    ret.maxLifetime = maxLifetime;
  }
  if (onconnect !== undefined) {
    ret.onconnect = onconnect;
  }
  if (onclose !== undefined) {
    ret.onclose = onclose;
  }
  ret.max = max || 10;

  return ret;
}

enum ReservedConnectionState {
  acceptQueries = 1 << 0,
  closed = 1 << 1,
}

function assertValidTransactionName(name: string) {
  if (name.indexOf("'") !== -1) {
    throw Error(`Distributed transaction name cannot contain single quotes.`);
  }
}
function SQL(o, e = {}) {
  if (typeof o === "string" || o instanceof URL) {
    o = { ...e, url: o };
  }
  var connectionInfo = loadOptions(o);
  var pool = new ConnectionPool(connectionInfo);

  function doCreateQuery(strings, values, allowUnsafeTransaction) {
    const sqlString = normalizeStrings(strings, values);
    let columns;
    if (hasSQLArrayParameter) {
      hasSQLArrayParameter = false;
      const v = values[0];
      columns = v.columns;
      values = v.value;
    }
    if (!allowUnsafeTransaction) {
      if (connectionInfo.max !== 1) {
        const upperCaseSqlString = sqlString.toUpperCase().trim();
        if (upperCaseSqlString.startsWith("BEGIN") || upperCaseSqlString.startsWith("START TRANSACTION")) {
          throw $ERR_POSTGRES_UNSAFE_TRANSACTION("Only use sql.begin, sql.reserved or max: 1");
        }
      }
    }
    return createQuery(sqlString, values, new SQLResultArray(), columns);
  }

  function onQueryDisconnected(err) {
    // connection closed mid query this will not be called if the query finishes first
    const query = this;
    if (err) {
      return query.reject(err);
    }
    // query is cancelled when waiting for a connection from the pool
    if (query.cancelled) {
      return query.reject($ERR_POSTGRES_QUERY_CANCELLED("Query cancelled"));
    }
  }

  function onQueryConnected(handle, err, pooledConnection) {
    const query = this;
    if (err) {
      // fail to aquire a connection from the pool
      return query.reject(err);
    }
    // query is cancelled when waiting for a connection from the pool
    if (query.cancelled) {
      pool.release(pooledConnection); // release the connection back to the pool
      return query.reject($ERR_POSTGRES_QUERY_CANCELLED("Query cancelled"));
    }
    // bind close event to the query (will unbind and auto release the connection when the query is finished)
    pooledConnection.bindQuery(query, onQueryDisconnected.bind(query));
    handle.run(pooledConnection.connection, query);
  }
  function queryFromPoolHandler(query, handle, err) {
    if (err) {
      // fail to create query
      return query.reject(err);
    }
    // query is cancelled
    if (!handle || query.cancelled) {
      return query.reject($ERR_POSTGRES_QUERY_CANCELLED("Query cancelled"));
    }

    pool.connect(onQueryConnected.bind(query, handle));
  }
  function queryFromPool(strings, values) {
    try {
      return new Query(doCreateQuery(strings, values, false), queryFromPoolHandler);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function onTransactionQueryDisconnected(query) {
    const transactionQueries = this;
    transactionQueries.delete(query);
  }
  function queryFromTransactionHandler(transactionQueries, query, handle, err) {
    const pooledConnection = this;
    if (err) {
      transactionQueries.delete(query);
      return query.reject(err);
    }
    // query is cancelled
    if (query.cancelled) {
      transactionQueries.delete(query);
      return query.reject($ERR_POSTGRES_QUERY_CANCELLED("Query cancelled"));
    }

    query.finally(onTransactionQueryDisconnected.bind(transactionQueries, query));
    handle.run(pooledConnection.connection, query);
  }
  function queryFromTransaction(strings, values, pooledConnection, transactionQueries) {
    try {
      const query = new Query(
        doCreateQuery(strings, values, true),
        queryFromTransactionHandler.bind(pooledConnection, transactionQueries),
      );
      transactionQueries.add(query);
      return query;
    } catch (err) {
      return Promise.reject(err);
    }
  }
  function onTransactionDisconnected(err) {
    const reject = this.reject;
    this.connectionState |= ReservedConnectionState.closed;

    for (const query of this.queries) {
      (query as Query).reject(err);
    }
    if (err) {
      return reject(err);
    }
  }

  function onReserveConnected(err, pooledConnection) {
    const { promise, resolve, reject } = this;
    if (err) {
      return reject(err);
    }

    let reservedTransaction = new Set();

    const state = {
      connectionState: ReservedConnectionState.acceptQueries,
      reject,
      storedError: null,
      queries: new Set(),
    };
    const onClose = onTransactionDisconnected.bind(state);
    pooledConnection.onClose(onClose);

    function reserved_sql(strings, ...values) {
      if (
        state.connectionState & ReservedConnectionState.closed ||
        !(state.connectionState & ReservedConnectionState.acceptQueries)
      ) {
        return Promise.reject(connectionClosedError());
      }
      if ($isJSArray(strings) && strings[0] && typeof strings[0] === "object") {
        return new SQLArrayParameter(strings, values);
      }
      // we use the same code path as the transaction sql
      return queryFromTransaction(strings, values, pooledConnection, state.queries);
    }
    reserved_sql.connect = () => {
      if (state.connectionState & ReservedConnectionState.closed) {
        return Promise.reject(connectionClosedError());
      }
      return Promise.resolve(reserved_sql);
    };

    reserved_sql.commitDistributed = async function (name: string) {
      const adapter = connectionInfo.adapter;
      assertValidTransactionName(name);
      switch (adapter) {
        case "postgres":
          return await reserved_sql(`COMMIT PREPARED '${name}'`);
        case "mysql":
          return await reserved_sql(`XA COMMIT '${name}'`);
        case "mssql":
          throw Error(`MSSQL distributed transaction is automatically committed.`);
        case "sqlite":
          throw Error(`SQLite dont support distributed transactions.`);
        default:
          throw Error(`Unsupported adapter: ${adapter}.`);
      }
    };
    reserved_sql.rollbackDistributed = async function (name: string) {
      assertValidTransactionName(name);
      const adapter = connectionInfo.adapter;
      switch (adapter) {
        case "postgres":
          return await reserved_sql(`ROLLBACK PREPARED '${name}'`);
        case "mysql":
          return await reserved_sql(`XA ROLLBACK '${name}'`);
        case "mssql":
          throw Error(`MSSQL distributed transaction is automatically rolled back.`);
        case "sqlite":
          throw Error(`SQLite dont support distributed transactions.`);
        default:
          throw Error(`Unsupported adapter: ${adapter}.`);
      }
    };

    // reserve is allowed to be called inside reserved connection but will return a new reserved connection from the pool
    // this matchs the behavior of the postgres package
    reserved_sql.reserve = () => sql.reserve();
    function onTransactionFinished(transaction_promise: Promise<any>) {
      reservedTransaction.delete(transaction_promise);
    }
    reserved_sql.beginDistributed = (name: string, fn: TransactionCallback) => {
      // begin is allowed the difference is that we need to make sure to use the same connection and never release it
      if (state.connectionState & ReservedConnectionState.closed) {
        return Promise.reject(connectionClosedError());
      }
      let callback = fn;

      if (typeof name !== "string") {
        return Promise.reject($ERR_INVALID_ARG_VALUE("name", name, "must be a string"));
      }

      if (!$isCallable(callback)) {
        return Promise.reject($ERR_INVALID_ARG_VALUE("fn", callback, "must be a function"));
      }
      const { promise, resolve, reject } = Promise.withResolvers();
      // lets just reuse the same code path as the transaction begin
      onTransactionConnected(callback, name, resolve, reject, true, true, null, pooledConnection);
      reservedTransaction.add(promise);
      promise.finally(onTransactionFinished.bind(null, promise));
      return promise;
    };
    reserved_sql.begin = (options_or_fn: string | TransactionCallback, fn?: TransactionCallback) => {
      // begin is allowed the difference is that we need to make sure to use the same connection and never release it
      if (
        state.connectionState & ReservedConnectionState.closed ||
        !(state.connectionState & ReservedConnectionState.acceptQueries)
      ) {
        return Promise.reject(connectionClosedError());
      }
      let callback = fn;
      let options: string | undefined = options_or_fn as unknown as string;
      if ($isCallable(options_or_fn)) {
        callback = options_or_fn as unknown as TransactionCallback;
        options = undefined;
      } else if (typeof options_or_fn !== "string") {
        return Promise.reject($ERR_INVALID_ARG_VALUE("options", options_or_fn, "must be a string"));
      }
      if (!$isCallable(callback)) {
        return Promise.reject($ERR_INVALID_ARG_VALUE("fn", callback, "must be a function"));
      }
      const { promise, resolve, reject } = Promise.withResolvers();
      // lets just reuse the same code path as the transaction begin
      onTransactionConnected(callback, options, resolve, reject, true, false, null, pooledConnection);
      reservedTransaction.add(promise);
      promise.finally(onTransactionFinished.bind(null, promise));
      return promise;
    };

    reserved_sql.flush = () => {
      if (state.connectionState & ReservedConnectionState.closed) {
        throw connectionClosedError();
      }
      return pooledConnection.flush();
    };
    reserved_sql.close = async (options?: { timeout?: number }) => {
      const reserveQueries = state.queries;
      if (
        state.connectionState & ReservedConnectionState.closed ||
        !(state.connectionState & ReservedConnectionState.acceptQueries)
      ) {
        return Promise.reject(connectionClosedError());
      }
      state.connectionState &= ~ReservedConnectionState.acceptQueries;
      let timeout = options?.timeout;
      if (timeout) {
        timeout = Number(timeout);
        if (timeout > 2 ** 31 || timeout < 0 || timeout !== timeout) {
          throw $ERR_INVALID_ARG_VALUE("options.timeout", timeout, "must be a non-negative integer less than 2^31");
        }
        if (timeout > 0 && (reserveQueries.size > 0 || reservedTransaction.size > 0)) {
          const { promise, resolve } = Promise.withResolvers();
          // race all queries vs timeout
          const pending_queries = Array.from(reserveQueries);
          const pending_transactions = Array.from(reservedTransaction);
          const timer = setTimeout(() => {
            state.connectionState |= ReservedConnectionState.closed;
            for (const query of reserveQueries) {
              (query as Query).cancel();
            }
            state.connectionState |= ReservedConnectionState.closed;
            pooledConnection.close();

            resolve();
          }, timeout * 1000);
          timer.unref(); // dont block the event loop
          Promise.all([Promise.all(pending_queries), Promise.all(pending_transactions)]).finally(() => {
            clearTimeout(timer);
            resolve();
          });
          return promise;
        }
      }
      state.connectionState |= ReservedConnectionState.closed;
      for (const query of reserveQueries) {
        (query as Query).cancel();
      }

      pooledConnection.close();

      return Promise.resolve(undefined);
    };
    reserved_sql.release = () => {
      if (
        state.connectionState & ReservedConnectionState.closed ||
        !(state.connectionState & ReservedConnectionState.acceptQueries)
      ) {
        return Promise.reject(connectionClosedError());
      }
      // just release the connection back to the pool
      state.connectionState |= ReservedConnectionState.closed;
      state.connectionState &= ~ReservedConnectionState.acceptQueries;
      pooledConnection.queries.delete(onClose);
      pool.release(pooledConnection);
      return Promise.resolve(undefined);
    };
    // this dont need to be async dispose only disposable but we keep compatibility with other types of sql functions
    reserved_sql[Symbol.asyncDispose] = () => reserved_sql.release();
    reserved_sql[Symbol.dispose] = () => reserved_sql.release();

    reserved_sql.options = sql.options;
    reserved_sql.transaction = reserved_sql.begin;
    reserved_sql.distributed = reserved_sql.beginDistributed;
    reserved_sql.end = reserved_sql.close;
    resolve(reserved_sql);
  }
  async function onTransactionConnected(
    callback,
    options,
    resolve,
    reject,
    dontRelease,
    distributed,
    err,
    pooledConnection,
  ) {
    /*
    BEGIN; -- works on POSTGRES, MySQL (autocommit is true, no options accepted), and SQLite (no options accepted) (need to change to BEGIN TRANSACTION on MSSQL)
    START TRANSACTION; -- works on POSTGRES, MySQL (autocommit is false, options accepted), (need to change to BEGIN TRANSACTION on MSSQL and BEGIN on SQLite)

    -- Create a SAVEPOINT
    SAVEPOINT my_savepoint; -- works on POSTGRES, MySQL, and SQLite (need to change to SAVE TRANSACTION on MSSQL)

    -- QUERY

    -- Roll back to SAVEPOINT if needed
    ROLLBACK TO SAVEPOINT my_savepoint; -- works on POSTGRES, MySQL, and SQLite (need to change to ROLLBACK TRANSACTION on MSSQL)

    -- Release the SAVEPOINT
    RELEASE SAVEPOINT my_savepoint; -- works on POSTGRES, MySQL, and SQLite (MSSQL dont have RELEASE SAVEPOINT you just need to transaction again)

    -- Commit the transaction
    COMMIT; -- works on POSTGRES, MySQL, and SQLite (need to change to COMMIT TRANSACTION on MSSQL)
    -- or rollback everything
    ROLLBACK; -- works on POSTGRES, MySQL, and SQLite (need to change to ROLLBACK TRANSACTION on MSSQL)

    */

    if (err) {
      return reject(err);
    }
    const state = {
      connectionState: ReservedConnectionState.acceptQueries,
      reject,
      queries: new Set(),
    };

    let savepoints = 0;
    let transactionSavepoints = new Set();
    const adapter = connectionInfo.adapter;
    let BEGIN_COMMAND: string = "BEGIN";
    let ROLLBACK_COMMAND: string = "COMMIT";
    let COMMIT_COMMAND: string = "ROLLBACK";
    let SAVEPOINT_COMMAND: string = "SAVEPOINT";
    let RELEASE_SAVEPOINT_COMMAND: string | null = "RELEASE SAVEPOINT";
    let ROLLBACK_TO_SAVEPOINT_COMMAND: string = "ROLLBACK TO SAVEPOINT";
    // MySQL and maybe other adapters need to call XA END or some other command before commit or rollback in a distributed transaction
    let BEFORE_COMMIT_OR_ROLLBACK_COMMAND: string | null = null;
    if (distributed) {
      if (options.indexOf("'") !== -1) {
        pool.release(pooledConnection);
        return reject(new Error(`Distributed transaction name cannot contain single quotes.`));
      }
      // distributed transaction
      // in distributed transaction options is the name/id of the transaction
      switch (adapter) {
        case "postgres":
          // in postgres we only need to call prepare transaction instead of commit
          COMMIT_COMMAND = `PREPARE TRANSACTION '${options}'`;
          break;
        case "mysql":
          // MySQL we use XA transactions
          // START TRANSACTION is autocommit false
          BEGIN_COMMAND = `XA START '${options}'`;
          BEFORE_COMMIT_OR_ROLLBACK_COMMAND = `XA END '${options}'`;
          COMMIT_COMMAND = `XA PREPARE '${options}'`;
          ROLLBACK_COMMAND = `XA ROLLBACK '${options}'`;
          break;
        case "sqlite":
          pool.release(pooledConnection);

          // do not support options just use defaults
          return reject(new Error(`SQLite dont support distributed transactions.`));
        case "mssql":
          BEGIN_COMMAND = ` BEGIN DISTRIBUTED TRANSACTION ${options}`;
          ROLLBACK_COMMAND = `ROLLBACK TRANSACTION ${options}`;
          COMMIT_COMMAND = `COMMIT TRANSACTION ${options}`;
          break;
        default:
          pool.release(pooledConnection);

          // TODO: use ERR_
          return reject(new Error(`Unsupported adapter: ${adapter}.`));
      }
    } else {
      // normal transaction
      switch (adapter) {
        case "postgres":
          if (options) {
            BEGIN_COMMAND = `BEGIN ${options}`;
          }
          break;
        case "mysql":
          // START TRANSACTION is autocommit false
          BEGIN_COMMAND = options ? `START TRANSACTION ${options}` : "START TRANSACTION";
          break;

        case "sqlite":
          if (options) {
            // sqlite supports DEFERRED, IMMEDIATE, EXCLUSIVE
            BEGIN_COMMAND = `BEGIN ${options}`;
          }
          break;
        case "mssql":
          BEGIN_COMMAND = options ? `START TRANSACTION ${options}` : "START TRANSACTION";
          ROLLBACK_COMMAND = "ROLLBACK TRANSACTION";
          COMMIT_COMMAND = "COMMIT TRANSACTION";
          SAVEPOINT_COMMAND = "SAVE";
          RELEASE_SAVEPOINT_COMMAND = null; // mssql dont have release savepoint
          ROLLBACK_TO_SAVEPOINT_COMMAND = "ROLLBACK TRANSACTION";
          break;
        default:
          pool.release(pooledConnection);
          // TODO: use ERR_
          return reject(new Error(`Unsupported adapter: ${adapter}.`));
      }
    }
    const onClose = onTransactionDisconnected.bind(state);
    pooledConnection.onClose(onClose);

    function run_internal_transaction_sql(strings, ...values) {
      if (state.connectionState & ReservedConnectionState.closed) {
        return Promise.reject(connectionClosedError());
      }
      return queryFromTransaction(strings, values, pooledConnection, state.queries);
    }
    function transaction_sql(strings, ...values) {
      if (
        state.connectionState & ReservedConnectionState.closed ||
        !(state.connectionState & ReservedConnectionState.acceptQueries)
      ) {
        return Promise.reject(connectionClosedError());
      }
      if ($isJSArray(strings) && strings[0] && typeof strings[0] === "object") {
        return new SQLArrayParameter(strings, values);
      }

      return queryFromTransaction(strings, values, pooledConnection, state.queries);
    }
    // reserve is allowed to be called inside transaction connection but will return a new reserved connection from the pool and will not be part of the transaction
    // this matchs the behavior of the postgres package
    transaction_sql.reserve = () => sql.reserve();

    transaction_sql.connect = () => {
      if (state.connectionState & ReservedConnectionState.closed) {
        return Promise.reject(connectionClosedError());
      }

      return Promise.resolve(transaction_sql);
    };
    transaction_sql.commitDistributed = async function (name: string) {
      assertValidTransactionName(name);
      switch (adapter) {
        case "postgres":
          return await transaction_sql(`COMMIT PREPARED '${name}'`);
        case "mysql":
          return await transaction_sql(`XA COMMIT '${name}'`);
        case "mssql":
          throw Error(`MSSQL distributed transaction is automatically committed.`);
        case "sqlite":
          throw Error(`SQLite dont support distributed transactions.`);
        default:
          throw Error(`Unsupported adapter: ${adapter}.`);
      }
    };
    transaction_sql.rollbackDistributed = async function (name: string) {
      assertValidTransactionName(name);
      switch (adapter) {
        case "postgres":
          return await transaction_sql(`ROLLBACK PREPARED '${name}'`);
        case "mysql":
          return await transaction_sql(`XA ROLLBACK '${name}'`);
        case "mssql":
          throw Error(`MSSQL distributed transaction is automatically rolled back.`);
        case "sqlite":
          throw Error(`SQLite dont support distributed transactions.`);
        default:
          throw Error(`Unsupported adapter: ${adapter}.`);
      }
    };
    // begin is not allowed on a transaction we need to use savepoint() instead
    transaction_sql.begin = function () {
      if (distributed) {
        throw $ERR_POSTGRES_INVALID_TRANSACTION_STATE("cannot call begin inside a distributed transaction");
      }
      throw $ERR_POSTGRES_INVALID_TRANSACTION_STATE("cannot call begin inside a transaction use savepoint() instead");
    };

    transaction_sql.beginDistributed = function () {
      if (distributed) {
        throw $ERR_POSTGRES_INVALID_TRANSACTION_STATE("cannot call beginDistributed inside a distributed transaction");
      }
      throw $ERR_POSTGRES_INVALID_TRANSACTION_STATE(
        "cannot call beginDistributed inside a transaction use savepoint() instead",
      );
    };

    transaction_sql.flush = function () {
      if (state.connectionState & ReservedConnectionState.closed) {
        throw connectionClosedError();
      }
      return pooledConnection.flush();
    };
    transaction_sql.close = async function (options?: { timeout?: number }) {
      // we dont actually close the connection here, we just set the state to closed and rollback the transaction
      if (
        state.connectionState & ReservedConnectionState.closed ||
        !(state.connectionState & ReservedConnectionState.acceptQueries)
      ) {
        return Promise.reject(connectionClosedError());
      }
      state.connectionState &= ~ReservedConnectionState.acceptQueries;
      const transactionQueries = state.queries;
      let timeout = options?.timeout;
      if (timeout) {
        timeout = Number(timeout);
        if (timeout > 2 ** 31 || timeout < 0 || timeout !== timeout) {
          throw $ERR_INVALID_ARG_VALUE("options.timeout", timeout, "must be a non-negative integer less than 2^31");
        }

        if (timeout > 0 && (transactionQueries.size > 0 || transactionSavepoints.size > 0)) {
          const { promise, resolve } = Promise.withResolvers();
          // race all queries vs timeout
          const pending_queries = Array.from(transactionQueries);
          const pending_savepoints = Array.from(transactionSavepoints);
          const timer = setTimeout(async () => {
            for (const query of transactionQueries) {
              (query as Query).cancel();
            }
            if (BEFORE_COMMIT_OR_ROLLBACK_COMMAND) {
              await run_internal_transaction_sql(BEFORE_COMMIT_OR_ROLLBACK_COMMAND);
            }
            await run_internal_transaction_sql(ROLLBACK_COMMAND);
            state.connectionState |= ReservedConnectionState.closed;
            resolve();
          }, timeout * 1000);
          timer.unref(); // dont block the event loop
          Promise.all([Promise.all(pending_queries), Promise.all(pending_savepoints)]).finally(() => {
            clearTimeout(timer);
            resolve();
          });
          return promise;
        }
      }
      for (const query of transactionQueries) {
        (query as Query).cancel();
      }
      if (BEFORE_COMMIT_OR_ROLLBACK_COMMAND) {
        await run_internal_transaction_sql(BEFORE_COMMIT_OR_ROLLBACK_COMMAND);
      }
      await run_internal_transaction_sql(ROLLBACK_COMMAND);
      state.connectionState |= ReservedConnectionState.closed;
    };
    transaction_sql[Symbol.asyncDispose] = () => transaction_sql.close();
    transaction_sql.options = sql.options;

    transaction_sql.transaction = transaction_sql.begin;
    transaction_sql.distributed = transaction_sql.beginDistributed;
    transaction_sql.end = transaction_sql.close;
    function onSavepointFinished(savepoint_promise: Promise<any>) {
      transactionSavepoints.delete(savepoint_promise);
    }
    async function run_internal_savepoint(save_point_name: string, savepoint_callback: TransactionCallback) {
      await run_internal_transaction_sql(`${SAVEPOINT_COMMAND} ${save_point_name}`);

      try {
        let result = await savepoint_callback(transaction_sql);
        if (RELEASE_SAVEPOINT_COMMAND) {
          // mssql dont have release savepoint
          await run_internal_transaction_sql(`${RELEASE_SAVEPOINT_COMMAND} ${save_point_name}`);
        }
        if (Array.isArray(result)) {
          result = await Promise.all(result);
        }
        return result;
      } catch (err) {
        if (!(state.connectionState & ReservedConnectionState.closed)) {
          await run_internal_transaction_sql(`${ROLLBACK_TO_SAVEPOINT_COMMAND} ${save_point_name}`);
        }
        throw err;
      }
    }
    if (distributed) {
      transaction_sql.savepoint = async (fn: TransactionCallback, name?: string): Promise<any> => {
        throw $ERR_POSTGRES_INVALID_TRANSACTION_STATE("cannot call savepoint inside a distributed transaction");
      };
    } else {
      transaction_sql.savepoint = async (fn: TransactionCallback, name?: string): Promise<any> => {
        let savepoint_callback = fn;

        if (
          state.connectionState & ReservedConnectionState.closed ||
          !(state.connectionState & ReservedConnectionState.acceptQueries)
        ) {
          throw connectionClosedError();
        }

        if ($isCallable(name)) {
          savepoint_callback = name as unknown as TransactionCallback;
          name = "";
        }
        if (!$isCallable(savepoint_callback)) {
          throw $ERR_INVALID_ARG_VALUE("fn", callback, "must be a function");
        }
        // matchs the format of the savepoint name in postgres package
        const save_point_name = `s${savepoints++}${name ? `_${name}` : ""}`;
        const promise = run_internal_savepoint(save_point_name, savepoint_callback);
        transactionSavepoints.add(promise);
        promise.finally(onSavepointFinished.bind(null, promise));
        return await promise;
      };
    }
    let needs_rollback = false;
    try {
      await run_internal_transaction_sql(BEGIN_COMMAND);
      needs_rollback = true;
      let transaction_result = await callback(transaction_sql);
      if (Array.isArray(transaction_result)) {
        transaction_result = await Promise.all(transaction_result);
      }
      // at this point we dont need to rollback anymore
      needs_rollback = false;
      if (BEFORE_COMMIT_OR_ROLLBACK_COMMAND) {
        await run_internal_transaction_sql(BEFORE_COMMIT_OR_ROLLBACK_COMMAND);
      }
      await run_internal_transaction_sql(COMMIT_COMMAND);
      return resolve(transaction_result);
    } catch (err) {
      try {
        if (!(state.connectionState & ReservedConnectionState.closed) && needs_rollback) {
          if (BEFORE_COMMIT_OR_ROLLBACK_COMMAND) {
            await run_internal_transaction_sql(BEFORE_COMMIT_OR_ROLLBACK_COMMAND);
          }
          await run_internal_transaction_sql(ROLLBACK_COMMAND);
        }
      } catch (err) {
        return reject(err);
      }
      return reject(err);
    } finally {
      state.connectionState |= ReservedConnectionState.closed;
      pooledConnection.queries.delete(onClose);
      if (!dontRelease) {
        pool.release(pooledConnection);
      }
    }
  }
  function sql(strings, ...values) {
    /**
     * const users = [
     * {
     *   name: "Alice",
     *   age: 25,
     * },
     * {
     *   name: "Bob",
     *   age: 30,
     * },
     * ]
     * sql`insert into users ${sql(users)}`
     */
    if ($isJSArray(strings) && strings[0] && typeof strings[0] === "object") {
      return new SQLArrayParameter(strings, values);
    }

    return queryFromPool(strings, values);
  }

  sql.reserve = () => {
    if (pool.closed) {
      return Promise.reject(connectionClosedError());
    }

    const promiseWithResolvers = Promise.withResolvers();
    pool.connect(onReserveConnected.bind(promiseWithResolvers), true);
    return promiseWithResolvers.promise;
  };
  sql.rollbackDistributed = async function (name: string) {
    if (pool.closed) {
      throw connectionClosedError();
    }
    assertValidTransactionName(name);
    const adapter = connectionInfo.adapter;
    switch (adapter) {
      case "postgres":
        return await sql(`ROLLBACK PREPARED '${name}'`);
      case "mysql":
        return await sql(`XA ROLLBACK '${name}'`);
      case "mssql":
        throw Error(`MSSQL distributed transaction is automatically rolled back.`);
      case "sqlite":
        throw Error(`SQLite dont support distributed transactions.`);
      default:
        throw Error(`Unsupported adapter: ${adapter}.`);
    }
  };

  sql.commitDistributed = async function (name: string) {
    if (pool.closed) {
      throw connectionClosedError();
    }
    assertValidTransactionName(name);
    const adapter = connectionInfo.adapter;
    switch (adapter) {
      case "postgres":
        return await sql(`COMMIT PREPARED '${name}'`);
      case "mysql":
        return await sql(`XA COMMIT '${name}'`);
      case "mssql":
        throw Error(`MSSQL distributed transaction is automatically committed.`);
      case "sqlite":
        throw Error(`SQLite dont support distributed transactions.`);
      default:
        throw Error(`Unsupported adapter: ${adapter}.`);
    }
  };

  sql.beginDistributed = (name: string, fn: TransactionCallback) => {
    if (pool.closed) {
      return Promise.reject(connectionClosedError());
    }
    let callback = fn;

    if (typeof name !== "string") {
      return Promise.reject($ERR_INVALID_ARG_VALUE("name", name, "must be a string"));
    }

    if (!$isCallable(callback)) {
      return Promise.reject($ERR_INVALID_ARG_VALUE("fn", callback, "must be a function"));
    }
    const { promise, resolve, reject } = Promise.withResolvers();
    // lets just reuse the same code path as the transaction begin
    pool.connect(onTransactionConnected.bind(null, callback, name, resolve, reject, false, true), true);
    return promise;
  };

  sql.begin = (options_or_fn: string | TransactionCallback, fn?: TransactionCallback) => {
    if (pool.closed) {
      return Promise.reject(connectionClosedError());
    }
    let callback = fn;
    let options: string | undefined = options_or_fn as unknown as string;
    if ($isCallable(options_or_fn)) {
      callback = options_or_fn as unknown as TransactionCallback;
      options = undefined;
    } else if (typeof options_or_fn !== "string") {
      return Promise.reject($ERR_INVALID_ARG_VALUE("options", options_or_fn, "must be a string"));
    }
    if (!$isCallable(callback)) {
      return Promise.reject($ERR_INVALID_ARG_VALUE("fn", callback, "must be a function"));
    }
    const { promise, resolve, reject } = Promise.withResolvers();
    pool.connect(onTransactionConnected.bind(null, callback, options, resolve, reject, false, false), true);
    return promise;
  };
  sql.connect = () => {
    if (pool.closed) {
      return Promise.reject(connectionClosedError());
    }

    if (pool.isConnected()) {
      return Promise.resolve(sql);
    }

    let { resolve, reject, promise } = Promise.withResolvers();
    const onConnected = (err, connection) => {
      if (err) {
        return reject(err);
      }
      // we are just measuring the connection here lets release it
      pool.release(connection);
      resolve(sql);
    };

    pool.connect(onConnected);

    return promise;
  };

  sql.close = async (options?: { timeout?: number }) => {
    await pool.close(options);
  };

  sql[Symbol.asyncDispose] = () => sql.close();

  sql.flush = () => pool.flush();
  sql.options = connectionInfo;

  sql.transaction = sql.begin;
  sql.distributed = sql.beginDistributed;
  sql.end = sql.close;
  return sql;
}

var lazyDefaultSQL;

function resetDefaultSQL(sql) {
  lazyDefaultSQL = sql;
  Object.assign(defaultSQLObject, lazyDefaultSQL);
  exportsObject.default = exportsObject.sql = lazyDefaultSQL;
}

var initialDefaultSQL;
var defaultSQLObject = (initialDefaultSQL = function sql(strings, ...values) {
  if (new.target) {
    return SQL(strings);
  }
  if (!lazyDefaultSQL) {
    resetDefaultSQL(SQL(undefined));
  }
  return lazyDefaultSQL(strings, ...values);
});

var exportsObject = {
  sql: defaultSQLObject,
  default: defaultSQLObject,
  SQL,
  Query,
  postgres: SQL,
};

export default exportsObject;
