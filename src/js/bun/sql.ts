import type * as BunTypes from "bun";

const enum QueryStatus {
  active = 1 << 1,
  cancelled = 1 << 2,
  error = 1 << 3,
  executed = 1 << 4,
  invalidHandle = 1 << 5,
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

const { hideFromStack } = require("internal/shared");
const defineProperties = Object.defineProperties;

function connectionClosedError() {
  return $ERR_POSTGRES_CONNECTION_CLOSED("Connection closed");
}
function notTaggedCallError() {
  return $ERR_POSTGRES_NOT_TAGGED_CALL("Query not called as a tagged template literal");
}
hideFromStack(connectionClosedError);
hideFromStack(notTaggedCallError);

enum SQLQueryResultMode {
  objects = 0,
  values = 1,
  raw = 2,
}
const escapeIdentifier = function escape(str) {
  return '"' + str.replaceAll('"', '""').replaceAll(".", '"."') + '"';
};
class SQLResultArray extends PublicArray {
  static [Symbol.toStringTag] = "SQLResults";

  constructor() {
    super();
    // match postgres's result array, in this way for in will not list the properties and .map will not return undefined command and count
    Object.defineProperties(this, {
      count: { value: null, writable: true },
      command: { value: null, writable: true },
    });
  }
  static get [Symbol.species]() {
    return Array;
  }
}

const _resolve = Symbol("resolve");
const _reject = Symbol("reject");
const _handle = Symbol("handle");
const _run = Symbol("run");
const _queryStatus = Symbol("status");
const _handler = Symbol("handler");
const _strings = Symbol("strings");
const _values = Symbol("values");
const _poolSize = Symbol("poolSize");
const _flags = Symbol("flags");
const _results = Symbol("results");
const PublicPromise = Promise;
type TransactionCallback = (sql: (strings: string, ...values: any[]) => Query) => Promise<any>;

const { createConnection: _createConnection, createQuery, init } = $zig("postgres.zig", "createBinding");

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
    case "required":
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

enum SQLQueryFlags {
  none = 0,
  allowUnsafeTransaction = 1 << 0,
  unsafe = 1 << 1,
  bigint = 1 << 2,
  simple = 1 << 3,
  notTagged = 1 << 4,
}

function getQueryHandle(query) {
  let handle = query[_handle];
  if (!handle) {
    try {
      query[_handle] = handle = doCreateQuery(
        query[_strings],
        query[_values],
        query[_flags] & SQLQueryFlags.allowUnsafeTransaction,
        query[_poolSize],
        query[_flags] & SQLQueryFlags.bigint,
        query[_flags] & SQLQueryFlags.simple,
      );
    } catch (err) {
      query[_queryStatus] |= QueryStatus.error | QueryStatus.invalidHandle;
      query.reject(err);
    }
  }
  return handle;
}

enum SQLCommand {
  insert = 0,
  update = 1,
  updateSet = 2,
  where = 3,
  whereIn = 4,
  none = -1,
}

function commandToString(command: SQLCommand): string {
  switch (command) {
    case SQLCommand.insert:
      return "INSERT";
    case SQLCommand.updateSet:
    case SQLCommand.update:
      return "UPDATE";
    case SQLCommand.whereIn:
    case SQLCommand.where:
      return "WHERE";
    default:
      return "";
  }
}

function detectCommand(query: string): SQLCommand {
  const text = query.toLowerCase().trim();
  const text_len = text.length;

  let token = "";
  let command = SQLCommand.none;
  let quoted = false;
  for (let i = 0; i < text_len; i++) {
    const char = text[i];
    switch (char) {
      case " ": // Space
      case "\n": // Line feed
      case "\t": // Tab character
      case "\r": // Carriage return
      case "\f": // Form feed
      case "\v": {
        switch (token) {
          case "insert": {
            if (command === SQLCommand.none) {
              return SQLCommand.insert;
            }
            return command;
          }
          case "update": {
            if (command === SQLCommand.none) {
              command = SQLCommand.update;
              token = "";
              continue; // try to find SET
            }
            return command;
          }
          case "where": {
            command = SQLCommand.where;
            token = "";
            continue; // try to find IN
          }
          case "set": {
            if (command === SQLCommand.update) {
              command = SQLCommand.updateSet;
              token = "";
              continue; // try to find WHERE
            }
            return command;
          }
          case "in": {
            if (command === SQLCommand.where) {
              return SQLCommand.whereIn;
            }
            return command;
          }
          default: {
            token = "";
            continue;
          }
        }
      }
      default: {
        // skip quoted commands
        if (char === '"') {
          quoted = !quoted;
          continue;
        }
        if (!quoted) {
          token += char;
        }
      }
    }
  }
  if (token) {
    switch (command) {
      case SQLCommand.none: {
        switch (token) {
          case "insert":
            return SQLCommand.insert;
          case "update":
            return SQLCommand.update;
          case "where":
            return SQLCommand.where;
          default:
            return SQLCommand.none;
        }
      }
      case SQLCommand.update: {
        if (token === "set") {
          return SQLCommand.updateSet;
        }
        return SQLCommand.update;
      }
      case SQLCommand.where: {
        if (token === "in") {
          return SQLCommand.whereIn;
        }
        return SQLCommand.where;
      }
    }
  }

  return command;
}

function normalizeQuery(strings, values, binding_idx = 1) {
  if (typeof strings === "string") {
    // identifier or unsafe query
    return [strings, values || []];
  }
  if (!$isArray(strings)) {
    // we should not hit this path
    throw new SyntaxError("Invalid query: SQL Fragment cannot be executed or was misused");
  }
  const str_len = strings.length;
  if (str_len === 0) {
    return ["", []];
  }
  let binding_values: any[] = [];
  let query = "";
  for (let i = 0; i < str_len; i++) {
    const string = strings[i];

    if (typeof string === "string") {
      query += string;
      if (values.length > i) {
        const value = values[i];
        if (value instanceof Query) {
          const [sub_query, sub_values] = normalizeQuery(value[_strings], value[_values], binding_idx);
          query += sub_query;
          for (let j = 0; j < sub_values.length; j++) {
            binding_values.push(sub_values[j]);
          }
          binding_idx += sub_values.length;
        } else if (value instanceof SQLArrayParameter) {
          const command = detectCommand(query);
          // only selectIn, insert, update, updateSet are allowed
          if (command === SQLCommand.none || command === SQLCommand.where) {
            throw new SyntaxError("Helper are only allowed for INSERT, UPDATE and WHERE IN commands");
          }
          const { columns, value: items } = value as SQLArrayParameter;
          const columnCount = columns.length;
          if (columnCount === 0 && command !== SQLCommand.whereIn) {
            throw new SyntaxError(`Cannot ${commandToString(command)} with no columns`);
          }
          const lastColumnIndex = columns.length - 1;

          if (command === SQLCommand.insert) {
            //
            // insert into users ${sql(users)} or insert into users ${sql(user)}
            //

            query += "(";
            for (let j = 0; j < columnCount; j++) {
              query += escapeIdentifier(columns[j]);
              if (j < lastColumnIndex) {
                query += ", ";
              }
            }
            query += ") VALUES";
            if ($isArray(items)) {
              const itemsCount = items.length;
              const lastItemIndex = itemsCount - 1;
              for (let j = 0; j < itemsCount; j++) {
                query += "(";
                const item = items[j];
                for (let k = 0; k < columnCount; k++) {
                  const column = columns[k];
                  const columnValue = item[column];
                  query += `$${binding_idx++}${k < lastColumnIndex ? ", " : ""}`;
                  if (typeof columnValue === "undefined") {
                    binding_values.push(null);
                  } else {
                    binding_values.push(columnValue);
                  }
                }
                if (j < lastItemIndex) {
                  query += "),";
                } else {
                  query += ") "; // the user can add RETURNING * or RETURNING id
                }
              }
            } else {
              query += "(";
              const item = items;
              for (let j = 0; j < columnCount; j++) {
                const column = columns[j];
                const columnValue = item[column];
                query += `$${binding_idx++}${j < lastColumnIndex ? ", " : ""}`;
                if (typeof columnValue === "undefined") {
                  binding_values.push(null);
                } else {
                  binding_values.push(columnValue);
                }
              }
              query += ") "; // the user can add RETURNING * or RETURNING id
            }
          } else if (command === SQLCommand.whereIn) {
            // SELECT * FROM users WHERE id IN (${sql([1, 2, 3])})
            if (!$isArray(items)) {
              throw new SyntaxError("An array of values is required for WHERE IN helper");
            }
            const itemsCount = items.length;
            const lastItemIndex = itemsCount - 1;
            query += "(";
            for (let j = 0; j < itemsCount; j++) {
              query += `$${binding_idx++}${j < lastItemIndex ? ", " : ""}`;
              if (columnCount > 0) {
                // we must use a key from a object
                if (columnCount > 1) {
                  // we should not pass multiple columns here
                  throw new SyntaxError("Cannot use WHERE IN helper with multiple columns");
                }
                // SELECT * FROM users WHERE id IN (${sql(users, "id")})
                const value = items[j];
                if (typeof value === "undefined") {
                  binding_values.push(null);
                } else {
                  const value_from_key = value[columns[0]];

                  if (typeof value_from_key === "undefined") {
                    binding_values.push(null);
                  } else {
                    binding_values.push(value_from_key);
                  }
                }
              } else {
                const value = items[j];
                if (typeof value === "undefined") {
                  binding_values.push(null);
                } else {
                  binding_values.push(value);
                }
              }
            }
            query += ") "; // more conditions can be added after this
          } else {
            // UPDATE users SET ${sql({ name: "John", age: 31 })} WHERE id = 1
            let item;
            if ($isArray(items)) {
              if (items.length > 1) {
                throw new SyntaxError("Cannot use array of objects for UPDATE");
              }
              item = items[0];
            } else {
              item = items;
            }
            // no need to include if is updateSet
            if (command === SQLCommand.update) {
              query += " SET ";
            }
            for (let i = 0; i < columnCount; i++) {
              const column = columns[i];
              const columnValue = item[column];
              query += `${escapeIdentifier(column)} = $${binding_idx++}${i < lastColumnIndex ? ", " : ""}`;
              if (typeof columnValue === "undefined") {
                binding_values.push(null);
              } else {
                binding_values.push(columnValue);
              }
            }
            query += " "; // the user can add where clause after this
          }
        } else {
          //TODO: handle sql.array parameters
          query += `$${binding_idx++} `;
          if (typeof value === "undefined") {
            binding_values.push(null);
          } else {
            binding_values.push(value);
          }
        }
      }
    } else {
      throw new SyntaxError("Invalid query: SQL Fragment cannot be executed or was misused");
    }
  }

  return [query, binding_values];
}

class Query extends PublicPromise {
  [_resolve];
  [_reject];
  [_handle];
  [_handler];
  [_queryStatus] = 0;
  [_strings];
  [_values];

  [Symbol.for("nodejs.util.inspect.custom")]() {
    const status = this[_queryStatus];
    const active = (status & QueryStatus.active) != 0;
    const cancelled = (status & QueryStatus.cancelled) != 0;
    const executed = (status & QueryStatus.executed) != 0;
    const error = (status & QueryStatus.error) != 0;
    return `PostgresQuery { ${active ? "active" : ""} ${cancelled ? "cancelled" : ""} ${executed ? "executed" : ""} ${error ? "error" : ""} }`;
  }

  constructor(strings, values, flags, poolSize, handler) {
    var resolve_, reject_;
    super((resolve, reject) => {
      resolve_ = resolve;
      reject_ = reject;
    });
    if (typeof strings === "string") {
      if (!(flags & SQLQueryFlags.unsafe)) {
        // identifier (cannot be executed in safe mode)
        flags |= SQLQueryFlags.notTagged;
        strings = escapeIdentifier(strings);
      }
    }
    this[_resolve] = resolve_;
    this[_reject] = reject_;
    this[_handle] = null;
    this[_handler] = handler;
    this[_queryStatus] = 0;
    this[_poolSize] = poolSize;
    this[_strings] = strings;
    this[_values] = values;
    this[_flags] = flags;

    this[_results] = null;
  }

  async [_run](async: boolean) {
    const { [_handler]: handler, [_queryStatus]: status } = this;

    if (status & (QueryStatus.executed | QueryStatus.error | QueryStatus.cancelled | QueryStatus.invalidHandle)) {
      return;
    }
    if (this[_flags] & SQLQueryFlags.notTagged) {
      this.reject(notTaggedCallError());
      return;
    }
    this[_queryStatus] |= QueryStatus.executed;

    const handle = getQueryHandle(this);
    if (!handle) return this;

    if (async) {
      // Ensure it's actually async
      // eslint-disable-next-line
      await 1;
    }

    try {
      return handler(this, handle);
    } catch (err) {
      this[_queryStatus] |= QueryStatus.error;
      this.reject(err);
    }
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
    const handle = getQueryHandle(this);
    if (!handle) return this;
    handle.done();
    return this[_resolve](x);
  }

  reject(x) {
    this[_queryStatus] &= ~QueryStatus.active;
    this[_queryStatus] |= QueryStatus.error;
    if (!(this[_queryStatus] & QueryStatus.invalidHandle)) {
      const handle = getQueryHandle(this);
      if (!handle) return this[_reject](x);
      handle.done();
    }

    return this[_reject](x);
  }

  cancel() {
    var status = this[_queryStatus];
    if (status & QueryStatus.cancelled) {
      return this;
    }
    this[_queryStatus] |= QueryStatus.cancelled;

    if (status & QueryStatus.executed) {
      const handle = getQueryHandle(this);
      handle.cancel();
    }

    return this;
  }

  execute() {
    this[_run](false);
    return this;
  }

  raw() {
    const handle = getQueryHandle(this);
    if (!handle) return this;
    handle.setMode(SQLQueryResultMode.raw);
    return this;
  }

  simple() {
    this[_flags] |= SQLQueryFlags.simple;
    return this;
  }

  values() {
    const handle = getQueryHandle(this);
    if (!handle) return this;
    handle.setMode(SQLQueryResultMode.values);
    return this;
  }

  then() {
    if (this[_flags] & SQLQueryFlags.notTagged) {
      throw notTaggedCallError();
    }
    this[_run](true);
    const result = super.$then.$apply(this, arguments);
    $markPromiseAsHandled(result);
    return result;
  }

  catch() {
    if (this[_flags] & SQLQueryFlags.notTagged) {
      throw notTaggedCallError();
    }
    this[_run](true);
    const result = super.catch.$apply(this, arguments);
    $markPromiseAsHandled(result);
    return result;
  }

  finally() {
    if (this[_flags] & SQLQueryFlags.notTagged) {
      throw notTaggedCallError();
    }
    this[_run](true);
    return super.finally.$apply(this, arguments);
  }
}
Object.defineProperty(Query, Symbol.species, { value: PublicPromise });
Object.defineProperty(Query, Symbol.toStringTag, { value: "Query" });
init(
  function onResolvePostgresQuery(query, result, commandTag, count, queries, is_last) {
    /// simple queries
    if (query[_flags] & SQLQueryFlags.simple) {
      // simple can have multiple results or a single result
      if (is_last) {
        if (queries) {
          const queriesIndex = queries.indexOf(query);
          if (queriesIndex !== -1) {
            queries.splice(queriesIndex, 1);
          }
        }
        try {
          query.resolve(query[_results]);
        } catch {}
        return;
      }
      $assert(result instanceof SQLResultArray, "Invalid result array");
      // prepare for next query
      query[_handle].setPendingValue(new SQLResultArray());

      if (typeof commandTag === "string") {
        if (commandTag.length > 0) {
          result.command = commandTag;
        }
      } else {
        result.command = cmds[commandTag];
      }

      result.count = count || 0;
      const last_result = query[_results];

      if (!last_result) {
        query[_results] = result;
      } else {
        if (last_result instanceof SQLResultArray) {
          // multiple results
          query[_results] = [last_result, result];
        } else {
          // 3 or more results
          last_result.push(result);
        }
      }
      return;
    }
    /// prepared statements
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
    } catch {}
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
    } catch {}
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
  connection: $ZigGeneratedClasses.PostgresSQLConnection | null = null;
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
        this.connection?.close();
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
    this.state = PooledConnectionState.pending;
    this.pool = pool;
    this.connectionInfo = connectionInfo;
    this.#startConnection();
  }
  async #startConnection() {
    this.connection = (await createConnection(
      this.connectionInfo,
      this.#onConnected.bind(this),
      this.#onClose.bind(this),
    )) as $ZigGeneratedClasses.PostgresSQLConnection;
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
    this.#startConnection();
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
      }
    }
    return true;
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
      if (connection.storedError) {
        // this connection got a error but maybe we can wait for another

        if (this.hasConnectionsAvailable()) {
          return;
        }

        const waitingQueue = this.waitingQueue;
        const reservedQueue = this.reservedQueue;

        this.waitingQueue = [];
        this.reservedQueue = [];
        // we have no connections available so lets fails
        for (const pending of waitingQueue) {
          pending(connection.storedError, connection);
        }
        for (const pending of reservedQueue) {
          pending(connection.storedError, connection);
        }
      }
      return;
    }

    if (was_reserved) {
      if (this.waitingQueue.length > 0 || this.reservedQueue.length > 0) {
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
      return;
    }
    if (connection.queryCount === 0) {
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
          connection.connection?.flush();
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
              connection.connection?.close();
            }
            break;
          case PooledConnectionState.connected:
            {
              const { promise, resolve } = Promise.withResolvers();
              connection.onFinish = resolve;
              promises.push(promise);
              connection.connection?.close();
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
      return;
    }
    let timeout = options?.timeout;
    if (timeout) {
      timeout = Number(timeout);
      if (timeout > 2 ** 31 || timeout < 0 || timeout !== timeout) {
        throw $ERR_INVALID_ARG_VALUE("options.timeout", timeout, "must be a non-negative integer less than 2^31");
      }
      this.closed = true;
      if (timeout === 0 || !this.hasPendingQueries()) {
        // close immediately
        await this.#close();
        return;
      }

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
    } else {
      this.closed = true;
      if (!this.hasPendingQueries()) {
        // close immediately
        await this.#close();
        return;
      }
      // gracefully close the pool
      const { promise, resolve } = Promise.withResolvers();
      this.onAllQueriesFinished = () => {
        // everything is closed, lets close the pool
        this.#close().finally(resolve);
      };
      return promise;
    }
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
        } else if (!retry_in_progress) {
          // impossible to connect or retry
          onConnected(storedError ?? connectionClosedError(), null);
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
      const firstConnection = new PooledConnection(this.connectionInfo, this);
      this.connections[0] = firstConnection;
      if (reserved) {
        firstConnection.flags |= PooledConnectionFlags.preReserved; // lets pre reserve the first connection
      }
      for (let i = 1; i < pollSize; i++) {
        this.connections[i] = new PooledConnection(this.connectionInfo, this);
      }
      return;
    }
    if (reserved) {
      let connectionWithLeastQueries: PooledConnection | null = null;
      let leastQueries = Infinity;
      for (const connection of this.readyConnections) {
        if (connection.flags & PooledConnectionFlags.preReserved || connection.flags & PooledConnectionFlags.reserved)
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

async function createConnection(options, onConnected, onClose) {
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
  } = options;

  let password = options.password;
  try {
    if (typeof password === "function") {
      password = password();
      if (password && $isPromise(password)) {
        password = await password;
      }
    }
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
      path || "",
      onConnected,
      onClose,
      idleTimeout,
      connectionTimeout,
      maxLifetime,
      !prepare,
    ) as $ZigGeneratedClasses.PostgresSQLConnection;
  } catch (e) {
    onClose(e);
  }
}

function doCreateQuery(strings, values, allowUnsafeTransaction, poolSize, bigint, simple) {
  const [sqlString, final_values] = normalizeQuery(strings, values);
  if (!allowUnsafeTransaction) {
    if (poolSize !== 1) {
      const upperCaseSqlString = sqlString.toUpperCase().trim();
      if (upperCaseSqlString.startsWith("BEGIN") || upperCaseSqlString.startsWith("START TRANSACTION")) {
        throw $ERR_POSTGRES_UNSAFE_TRANSACTION("Only use sql.begin, sql.reserved or max: 1");
      }
    }
  }
  return createQuery(sqlString, final_values, new SQLResultArray(), undefined, !!bigint, !!simple);
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

        throw new Error(`Keys must be strings or numbers: ${key}`);
      }
    }

    this.value = value;
    this.columns = keys;
  }
}

function decodeIfValid(value) {
  if (value) {
    return decodeURIComponent(value);
  }
  return null;
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
    max,
    bigint,
    path;
  let prepare = true;
  const env = Bun.env || {};
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
  o ||= {};
  query = "";

  if (url) {
    ({ hostname, port, username, password, adapter } = o);
    // object overrides url
    hostname ||= url.hostname;
    port ||= url.port;
    username ||= decodeIfValid(url.username);
    password ||= decodeIfValid(url.password);
    adapter ||= url.protocol;

    if (adapter[adapter.length - 1] === ":") {
      adapter = adapter.slice(0, -1);
    }

    const queryObject = url.searchParams.toJSON();
    for (const key in queryObject) {
      if (key.toLowerCase() === "sslmode") {
        sslMode = normalizeSSLMode(queryObject[key]);
      } else if (key.toLowerCase() === "path") {
        path = queryObject[key];
      } else {
        // this is valid for postgres for other databases it might not be valid
        // check adapter then implement for other databases
        // encode string with \0 as finalizer
        // must be key\0value\0
        query += `${key}\0${queryObject[key]}\0`;
      }
    }
    query = query.trim();
  }
  hostname ||= o.hostname || o.host || env.PGHOST || "localhost";

  port ||= Number(o.port || env.PGPORT || 5432);

  path ||= o.path || "";
  // add /.s.PGSQL.${port} if it doesn't exist
  if (path && path?.indexOf("/.s.PGSQL.") === -1) {
    path = `${path}/.s.PGSQL.${port}`;
  }

  username ||= o.username || o.user || env.PGUSERNAME || env.PGUSER || env.USER || env.USERNAME || "postgres";
  database ||= o.database || o.db || decodeIfValid((url?.pathname ?? "").slice(1)) || env.PGDATABASE || username;
  password ||= o.password || o.pass || env.PGPASSWORD || "";
  const connection = o.connection;
  if (connection && $isObject(connection)) {
    for (const key in connection) {
      if (connection[key] !== undefined) {
        query += `${key}\0${connection[key]}\0`;
      }
    }
  }
  tls ||= o.tls || o.ssl;
  adapter ||= o.adapter || "postgres";
  max = o.max;

  idleTimeout ??= o.idleTimeout;
  idleTimeout ??= o.idle_timeout;
  connectionTimeout ??= o.connectionTimeout;
  connectionTimeout ??= o.connection_timeout;
  maxLifetime ??= o.maxLifetime;
  maxLifetime ??= o.max_lifetime;
  bigint ??= o.bigint;
  // we need to explicitly set prepare to false if it is false
  if (o.prepare === false) {
    prepare = false;
  }

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
    idleTimeout *= 1000;
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
    connectionTimeout *= 1000;
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
    maxLifetime *= 1000;
  }

  if (max != null) {
    max = Number(max);
    if (max > 2 ** 31 || max < 1 || max !== max) {
      throw $ERR_INVALID_ARG_VALUE("options.max", max, "must be a non-negative integer between 1 and 2^31");
    }
  }

  if (sslMode !== SSLMode.disable && !tls?.serverName) {
    if (hostname) {
      tls = { ...tls, serverName: hostname };
    } else if (tls) {
      tls = true;
    }
  }

  if (tls && sslMode === SSLMode.disable) {
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
  const ret: any = { hostname, port, username, password, database, tls, query, sslMode, adapter, prepare, bigint };
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
      return new Query(
        strings,
        values,
        connectionInfo.bigint ? SQLQueryFlags.bigint : SQLQueryFlags.none,
        connectionInfo.max,
        queryFromPoolHandler,
      );
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function unsafeQuery(strings, values) {
    try {
      let flags = connectionInfo.bigint ? SQLQueryFlags.bigint | SQLQueryFlags.unsafe : SQLQueryFlags.unsafe;
      if ((values?.length ?? 0) === 0) {
        flags |= SQLQueryFlags.simple;
      }
      return new Query(strings, values, flags, connectionInfo.max, queryFromPoolHandler);
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
        strings,
        values,
        connectionInfo.bigint
          ? SQLQueryFlags.allowUnsafeTransaction | SQLQueryFlags.bigint
          : SQLQueryFlags.allowUnsafeTransaction,
        connectionInfo.max,
        queryFromTransactionHandler.bind(pooledConnection, transactionQueries),
      );
      transactionQueries.add(query);
      return query;
    } catch (err) {
      return Promise.reject(err);
    }
  }
  function unsafeQueryFromTransaction(strings, values, pooledConnection, transactionQueries) {
    try {
      let flags = connectionInfo.bigint
        ? SQLQueryFlags.allowUnsafeTransaction | SQLQueryFlags.unsafe | SQLQueryFlags.bigint
        : SQLQueryFlags.allowUnsafeTransaction | SQLQueryFlags.unsafe;

      if ((values?.length ?? 0) === 0) {
        flags |= SQLQueryFlags.simple;
      }
      const query = new Query(
        strings,
        values,
        flags,
        connectionInfo.max,
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
    const { resolve, reject } = this;
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
      if ($isArray(strings)) {
        // detect if is tagged template
        if (!$isArray((strings as unknown as TemplateStringsArray).raw)) {
          return new SQLArrayParameter(strings, values);
        }
      } else if (
        typeof strings === "object" &&
        !(strings instanceof Query) &&
        !(strings instanceof SQLArrayParameter)
      ) {
        return new SQLArrayParameter([strings], values);
      }
      // we use the same code path as the transaction sql
      return queryFromTransaction(strings, values, pooledConnection, state.queries);
    }
    reserved_sql.unsafe = (string, args = []) => {
      return unsafeQueryFromTransaction(string, args, pooledConnection, state.queries);
    };
    reserved_sql.file = async (path: string, args = []) => {
      return await Bun.file(path)
        .text()
        .then(text => {
          return unsafeQueryFromTransaction(text, args, pooledConnection, state.queries);
        });
    };
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
          return await reserved_sql.unsafe(`COMMIT PREPARED '${name}'`);
        case "mysql":
          return await reserved_sql.unsafe(`XA COMMIT '${name}'`);
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
          return await reserved_sql.unsafe(`ROLLBACK PREPARED '${name}'`);
        case "mysql":
          return await reserved_sql.unsafe(`XA ROLLBACK '${name}'`);
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
        return Promise.resolve(undefined);
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
    let ROLLBACK_COMMAND: string = "ROLLBACK";
    let COMMIT_COMMAND: string = "COMMIT";
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

    function run_internal_transaction_sql(string) {
      if (state.connectionState & ReservedConnectionState.closed) {
        return Promise.reject(connectionClosedError());
      }
      return unsafeQueryFromTransaction(string, [], pooledConnection, state.queries);
    }
    function transaction_sql(strings, ...values) {
      if (
        state.connectionState & ReservedConnectionState.closed ||
        !(state.connectionState & ReservedConnectionState.acceptQueries)
      ) {
        return Promise.reject(connectionClosedError());
      }
      if ($isArray(strings)) {
        // detect if is tagged template
        if (!$isArray((strings as unknown as TemplateStringsArray).raw)) {
          return new SQLArrayParameter(strings, values);
        }
      } else if (
        typeof strings === "object" &&
        !(strings instanceof Query) &&
        !(strings instanceof SQLArrayParameter)
      ) {
        return new SQLArrayParameter([strings], values);
      }

      return queryFromTransaction(strings, values, pooledConnection, state.queries);
    }
    transaction_sql.unsafe = (string, args = []) => {
      return unsafeQueryFromTransaction(string, args, pooledConnection, state.queries);
    };
    transaction_sql.file = async (path: string, args = []) => {
      return await Bun.file(path)
        .text()
        .then(text => {
          return unsafeQueryFromTransaction(text, args, pooledConnection, state.queries);
        });
    };
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
          return await run_internal_transaction_sql(`COMMIT PREPARED '${name}'`);
        case "mysql":
          return await run_internal_transaction_sql(`XA COMMIT '${name}'`);
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
          return await run_internal_transaction_sql(`ROLLBACK PREPARED '${name}'`);
        case "mysql":
          return await run_internal_transaction_sql(`XA ROLLBACK '${name}'`);
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
        return Promise.resolve(undefined);
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
        if ($isArray(result)) {
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
      transaction_sql.savepoint = async (_fn: TransactionCallback, _name?: string): Promise<any> => {
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
      if ($isArray(transaction_result)) {
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
    if ($isArray(strings)) {
      // detect if is tagged template
      if (!$isArray((strings as unknown as TemplateStringsArray).raw)) {
        return new SQLArrayParameter(strings, values);
      }
    } else if (typeof strings === "object" && !(strings instanceof Query) && !(strings instanceof SQLArrayParameter)) {
      return new SQLArrayParameter([strings], values);
    }

    return queryFromPool(strings, values);
  }

  sql.unsafe = (string, args = []) => {
    return unsafeQuery(string, args);
  };
  sql.file = async (path: string, args = []) => {
    return await Bun.file(path)
      .text()
      .then(text => {
        return unsafeQuery(text, args);
      });
  };
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
        return await sql.unsafe(`ROLLBACK PREPARED '${name}'`);
      case "mysql":
        return await sql.unsafe(`XA ROLLBACK '${name}'`);
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
        return await sql.unsafe(`COMMIT PREPARED '${name}'`);
      case "mysql":
        return await sql.unsafe(`XA COMMIT '${name}'`);
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

var lazyDefaultSQL: InstanceType<typeof BunTypes.SQL>;

function resetDefaultSQL(sql) {
  lazyDefaultSQL = sql;
  // this will throw "attempt to assign to readonly property"
  // Object.assign(defaultSQLObject, lazyDefaultSQL);
  // exportsObject.default = exportsObject.sql = lazyDefaultSQL;
}

function ensureDefaultSQL() {
  if (!lazyDefaultSQL) {
    resetDefaultSQL(SQL(undefined));
  }
}

var defaultSQLObject: InstanceType<typeof BunTypes.SQL> = function sql(strings, ...values) {
  if (new.target) {
    return SQL(strings);
  }
  if (!lazyDefaultSQL) {
    resetDefaultSQL(SQL(undefined));
  }
  return lazyDefaultSQL(strings, ...values);
} as typeof BunTypes.SQL;

defaultSQLObject.reserve = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.reserve(...args);
};
defaultSQLObject.commitDistributed = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.commitDistributed(...args);
};
defaultSQLObject.rollbackDistributed = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.rollbackDistributed(...args);
};
defaultSQLObject.distributed = defaultSQLObject.beginDistributed = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.beginDistributed(...args);
};

defaultSQLObject.connect = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.connect(...args);
};

defaultSQLObject.unsafe = (...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.unsafe(...args);
};

defaultSQLObject.file = (filename: string, ...args) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.file(filename, ...args);
};

defaultSQLObject.transaction = defaultSQLObject.begin = function (...args: Parameters<typeof lazyDefaultSQL.begin>) {
  ensureDefaultSQL();
  return lazyDefaultSQL.begin(...args);
} as (typeof BunTypes.SQL)["begin"];

defaultSQLObject.end = defaultSQLObject.close = (...args: Parameters<typeof lazyDefaultSQL.close>) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.close(...args);
};
defaultSQLObject.flush = (...args: Parameters<typeof lazyDefaultSQL.flush>) => {
  ensureDefaultSQL();
  return lazyDefaultSQL.flush(...args);
};
//define lazy properties
defineProperties(defaultSQLObject, {
  options: {
    get: () => {
      ensureDefaultSQL();
      return lazyDefaultSQL.options;
    },
  },
  [Symbol.asyncDispose]: {
    get: () => {
      ensureDefaultSQL();
      return lazyDefaultSQL[Symbol.asyncDispose];
    },
  },
});

var exportsObject = {
  sql: defaultSQLObject,
  default: defaultSQLObject,
  SQL,
  Query,
  postgres: SQL,
};

export default exportsObject;
