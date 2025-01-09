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
    onclose;
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
  return ret;
}

function SQL(o) {
  var connection,
    connected = false,
    connecting = false,
    closed = false,
    onConnect: any[] = [],
    storedErrorForClosedConnection,
    connectionInfo = loadOptions(o);

  function connectedHandler(query, handle, err) {
    if (err) {
      return query.reject(err);
    }

    if (!connected) {
      return query.reject(storedErrorForClosedConnection || new Error("Not connected"));
    }

    if (query.cancelled) {
      return query.reject(new Error("Query cancelled"));
    }

    handle.run(connection, query);

    // if the above throws, we don't want it to be in the array.
    // This array exists mostly to keep the in-flight queries alive.
    connection.queries.push(query);
  }

  function pendingConnectionHandler(query, handle) {
    onConnect.push(err => connectedHandler(query, handle, err));
    if (!connecting) {
      connecting = true;
      connection = createConnection(connectionInfo, onConnected, onClose);
    }
  }

  function closedConnectionHandler(query, handle) {
    query.reject(storedErrorForClosedConnection || new Error("Connection closed"));
  }

  function onConnected(err, result) {
    connected = !err;
    for (const handler of onConnect) {
      handler(err);
    }
    onConnect = [];

    if (connected && connectionInfo?.onconnect) {
      connectionInfo.onconnect(err);
    }
  }

  function onClose(err, queries) {
    closed = true;
    storedErrorForClosedConnection = err;
    if (sql === lazyDefaultSQL) {
      resetDefaultSQL(initialDefaultSQL);
    }

    onConnected(err, undefined);
    if (queries) {
      const queriesCopy = queries.slice();
      queries.length = 0;
      for (const handler of queriesCopy) {
        handler.reject(err);
      }
    }

    if (connectionInfo?.onclose) {
      connectionInfo.onclose(err);
    }
  }

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

  function connectedSQL(strings, values) {
    return new Query(doCreateQuery(strings, values), connectedHandler);
  }

  function closedSQL(strings, values) {
    return new Query(undefined, closedConnectionHandler);
  }

  function pendingSQL(strings, values) {
    return new Query(doCreateQuery(strings, values), pendingConnectionHandler);
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

    if (closed) {
      return closedSQL(strings, values);
    }

    if (connected) {
      return connectedSQL(strings, values);
    }

    return pendingSQL(strings, values);
  }

  sql.connect = () => {
    if (closed) {
      return Promise.reject(new Error("Connection closed"));
    }

    if (connected) {
      return Promise.resolve(sql);
    }

    var { resolve, reject, promise } = Promise.withResolvers();
    onConnect.push(err => (err ? reject(err) : resolve(sql)));
    if (!connecting) {
      connecting = true;
      connection = createConnection(connectionInfo, onConnected, onClose);
    }

    return promise;
  };

  sql.close = () => {
    if (closed) {
      return Promise.resolve();
    }

    var { resolve, promise } = Promise.withResolvers();
    onConnect.push(resolve);
    connection.close();
    return promise;
  };

  sql[Symbol.asyncDispose] = () => sql.close();

  sql.flush = () => {
    if (closed || !connected) {
      return;
    }

    connection.flush();
  };
  sql.options = connectionInfo;

  sql.then = () => {
    if (closed) {
      return Promise.reject(new Error("Connection closed"));
    }

    if (connected) {
      return Promise.resolve(sql);
    }

    const { resolve, reject, promise } = Promise.withResolvers();
    onConnect.push(err => (err ? reject(err) : resolve(sql)));
    if (!connecting) {
      connecting = true;
      connection = createConnection(connectionInfo, onConnected, onClose);
    }

    return promise;
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
