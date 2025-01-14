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
    return super.$then.$apply(this, arguments);
  }

  catch() {
    this[_run]();
    return super.catch.$apply(this, arguments);
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
class PooledConnection {
  pool: ConnectionPool;
  connection: ReturnType<typeof createConnection>;
  state: "pending" | "connected" | "closed" = "pending";
  storedError: Error | null = null;
  queries: Set<(err: Error) => void> = new Set();
  onFinish: ((err: Error | null) => void) | null = null;
  canBeConnected: boolean = false;
  connectionInfo: any;
  #onConnected(err, _) {
    const connectionInfo = this.connectionInfo;
    if (connectionInfo?.onconnect) {
      connectionInfo.onconnect(err);
    }
    this.storedError = err;
    this.canBeConnected = !err;
    this.state = err ? "closed" : "connected";
    const onFinish = this.onFinish;
    if (onFinish) {
      // pool is closed, lets finish the connection
      if (err) {
        onFinish(err);
      } else {
        this.connection.close();
      }
      return;
    }
    this.pool.release(this);
  }
  #onClose(err) {
    const connectionInfo = this.connectionInfo;
    if (connectionInfo?.onclose) {
      connectionInfo.onclose(err);
    }
    this.state = "closed";
    this.connection = null;
    this.storedError = err;

    // remove from ready connections if its there
    this.pool.readyConnections.delete(this);
    const queries = new Set(this.queries);
    this.queries.clear();
    // notify all queries that the connection is closed
    for (const onClose of queries) {
      onClose(err);
    }
    const onFinish = this.onFinish;
    if (onFinish) {
      onFinish(err);
    }

    this.pool.release(this);
  }
  constructor(connectionInfo, pool: ConnectionPool) {
    //TODO: maxLifetime, idleTimeout, connectionTimeout
    this.connection = createConnection(connectionInfo, this.#onConnected.bind(this), this.#onClose.bind(this));
    this.state = "pending";
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
    // retry connection
    this.connection = createConnection(
      this.connectionInfo,
      this.#onConnected.bind(this, this.connectionInfo),
      this.#onClose.bind(this, this.connectionInfo),
    );
  }
  retry() {
    // if pool is closed, we can't retry
    if (this.pool.closed) {
      return false;
    }
    // we need to reconnect
    // lets use a retry strategy
    // TODO: implement retry strategy, maxLifetime, idleTimeout, connectionTimeout

    // we can only retry if one day we are able to connect
    if (this.canBeConnected) {
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
          // we can't retry this are authentication errors
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
  poolStarted: boolean = false;
  closed: boolean = false;
  constructor(connectionInfo) {
    this.connectionInfo = connectionInfo;
    this.connections = new Array(connectionInfo.max);
    this.readyConnections = new Set();
  }

  release(connection: PooledConnection) {
    if (this.waitingQueue.length > 0) {
      // we have some pending connections, lets connect them with the released connection
      const pending = this.waitingQueue.shift();
      pending?.(connection.storedError, connection);
    } else {
      if (connection.state !== "connected") {
        // connection is not ready, lets not add it to the ready connections
        return;
      }
      // connection is ready, lets add it to the ready connections
      this.readyConnections.add(connection);
    }
  }

  isConnected() {
    if (this.readyConnections.size > 0) {
      return true;
    }
    if (this.poolStarted) {
      for (let i = 0; i < this.connections.length; i++) {
        const connection = this.connections[i];
        if (connection.state === "connected") {
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
      this.poolStarted = false;
      for (let i = 0; i < this.connections.length; i++) {
        const connection = this.connections[i];
        if (connection.state === "connected") {
          connection.connection.flush();
        }
      }
    }
  }
  close() {
    if (this.closed) {
      return Promise.reject(connectionClosedError());
    }
    this.closed = true;
    let pending;
    while ((pending = this.waitingQueue.shift())) {
      pending(connectionClosedError(), null);
    }
    const promises: Array<Promise<any>> = [];
    if (this.poolStarted) {
      this.poolStarted = false;
      for (let i = 0; i < this.connections.length; i++) {
        const connection = this.connections[i];
        switch (connection.state) {
          case "pending":
            {
              const { promise, resolve } = Promise.withResolvers();
              connection.onFinish = resolve;
              promises.push(promise);
            }
            break;
          case "connected":
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
  connect(onConnected: (err: Error | null, result: any) => void) {
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
          if (connection.state === "closed") {
            if (connection.retry()) {
              // lets wait for connection to be released
              if (!retry_in_progress) {
                // avoid adding to the queue twice, we wanna to retry every available pool connection
                retry_in_progress = true;
                this.waitingQueue.push(onConnected);
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
          this.waitingQueue.push(onConnected);
        } else {
          // impossible to connect or retry
          onConnected(storedError, null);
        }
        return;
      }
      // we never started the pool, lets start it
      this.waitingQueue.push(onConnected);
      this.poolStarted = true;
      const pollSize = this.connections.length;
      for (let i = 0; i < pollSize; i++) {
        this.connections[i] = new PooledConnection(this.connectionInfo, this);
      }
      return;
    }

    // we have some connection ready
    const first = this.readyConnections.values().next().value;
    this.readyConnections.delete(first);
    onConnected(null, first);
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
    ({ hostname, port, username, password, protocol: adapter } = o = url);
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
    throw new Error(`Invalid port: ${port}`);
  }

  if (adapter && !(adapter === "postgres" || adapter === "postgresql")) {
    throw new Error(`Unsupported adapter: ${adapter}. Only \"postgres\" is supported for now`);
  }

  const ret: any = { hostname, port, username, password, database, tls, query, sslMode };
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

function SQL(o) {
  var connectionInfo = loadOptions(o);
  var pool = new ConnectionPool(connectionInfo);

  function doCreateQuery(strings, values) {
    const sqlString = normalizeStrings(strings, values);
    let columns;
    if (hasSQLArrayParameter) {
      hasSQLArrayParameter = false;
      const v = values[0];
      columns = v.columns;
      values = v.value;
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
    if (query.cancelled) {
      return query.reject($ERR_POSTGRES_QUERY_CANCELLED("Query cancelled"));
    }

    pool.connect(onQueryConnected.bind(query, handle));
  }
  function queryFromPool(strings, values) {
    return new Query(doCreateQuery(strings, values), queryFromPoolHandler);
  }

  function onTransactionQueryDisconnected(query) {
    const transactionQueries = this;
    transactionQueries.delete(query);
  }
  function queryFromTransactionHandler(transactionQueries, query, handle, err) {
    const pooledConnection = this;
    if (err) {
      return query.reject(err);
    }
    // query is cancelled
    if (query.cancelled) {
      return query.reject($ERR_POSTGRES_QUERY_CANCELLED("Query cancelled"));
    }
    // keep the query alive until we finish the transaction or the query
    transactionQueries.add(query);
    query.finally(onTransactionQueryDisconnected.bind(transactionQueries, query));
    handle.run(pooledConnection.connection, query);
  }
  function queryFromTransaction(strings, values, pooledConnection, transactionQueries) {
    return new Query(
      doCreateQuery(strings, values),
      queryFromTransactionHandler.bind(pooledConnection, transactionQueries),
    );
  }
  function onTransactionDisconnected(err) {
    const reject = this.reject;
    this.closed = true;
    if (err) {
      return reject(err);
    }
  }
  async function onTransactionConnected(options, resolve, reject, err, pooledConnection) {
    const callback = this as unknown as TransactionCallback;
    if (err) {
      return reject(err);
    }
    const state = {
      closed: false,
      reject,
    };
    const onClose = onTransactionDisconnected.bind(state);
    pooledConnection.onClose(onClose);
    let savepoints = 0;
    let transactionQueries = new Set();

    function transaction_sql(strings, ...values) {
      if (state.closed) {
        return Promise.reject(connectionClosedError());
      }
      if ($isJSArray(strings) && strings[0] && typeof strings[0] === "object") {
        return new SQLArrayParameter(strings, values);
      }

      return queryFromTransaction(strings, values, pooledConnection, transactionQueries);
    }
    transaction_sql.connect = () => {
      if (state.closed) {
        return Promise.reject(connectionClosedError());
      }
      return Promise.resolve(transaction_sql);
    };
    // begin is not allowed on a transaction we need to use savepoint() instead
    transaction_sql.begin = function () {
      throw $ERR_POSTGRES_INVALID_TRANSACTION_STATE("cannot call begin inside a transaction use savepoint() instead");
    };

    transaction_sql.flush = function () {
      if (state.closed) {
        throw connectionClosedError();
      }
      return pooledConnection.flush();
    };
    transaction_sql.close = async function () {
      // we dont actually close the connection here, we just set the state to closed and rollback the transaction
      if (state.closed) {
        return Promise.reject(connectionClosedError());
      }
      await transaction_sql("ROLLBACK");
      state.closed = true;
    };
    transaction_sql[Symbol.asyncDispose] = () => transaction_sql.close();
    transaction_sql.then = transaction_sql.connect;
    transaction_sql.options = sql.options;

    transaction_sql.savepoint = async (fn: TransactionCallback, name?: string) => {
      let savepoint_callback = fn;

      if (state.closed) {
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
      await transaction_sql(`SAVEPOINT ${save_point_name}`);

      try {
        const result = await savepoint_callback(transaction_sql);
        await transaction_sql(`RELEASE SAVEPOINT ${save_point_name}`);
        return result;
      } catch (err) {
        if (!state.closed) {
          await transaction_sql(`ROLLBACK TO SAVEPOINT ${save_point_name}`);
        }
        throw err;
      }
    };
    let transaction_started = false;
    try {
      if (options) {
        //@ts-ignore
        await transaction_sql(`BEGIN ${options}`);
      } else {
        //@ts-ignore
        await transaction_sql("BEGIN");
      }
      transaction_started = true;
      const transaction_result = await callback(transaction_sql);
      await transaction_sql("COMMIT");
      return resolve(transaction_result);
    } catch (err) {
      try {
        if (!state.closed && transaction_started) {
          await transaction_sql("ROLLBACK");
        }
      } catch (err) {
        return reject(err);
      }
      return reject(err);
    } finally {
      state.closed = true;
      pooledConnection.queries.delete(onClose);
      pool.release(pooledConnection);
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

  sql.begin = async (options_or_fn: string | TransactionCallback, fn?: TransactionCallback) => {
    /*
    BEGIN; -- works on POSTGRES, MySQL, and SQLite (need to change to BEGIN TRANSACTION on MSSQL)

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

    if (pool.closed) {
      throw connectionClosedError();
    }
    let callback = fn;
    let options: string | undefined = options_or_fn as unknown as string;
    if ($isCallable(options_or_fn)) {
      callback = options_or_fn as unknown as TransactionCallback;
      options = undefined;
    } else if (typeof options_or_fn !== "string") {
      throw $ERR_INVALID_ARG_VALUE("options", options_or_fn, "must be a string");
    }
    if (!$isCallable(callback)) {
      throw $ERR_INVALID_ARG_VALUE("fn", callback, "must be a function");
    }
    const { promise, resolve, reject } = Promise.withResolvers();
    pool.connect(onTransactionConnected.bind(callback, options, resolve, reject));
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

  sql.close = () => {
    return pool.close();
  };

  sql[Symbol.asyncDispose] = () => sql.close();

  sql.flush = () => pool.flush();
  sql.options = connectionInfo;

  sql.then = () => {
    // should this wait queries to finish or just return if is connected?
    return sql.connect();
  };

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
