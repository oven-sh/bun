import type { PostgresErrorOptions } from "internal/sql/errors";
import type { Query } from "./query";
import type { ArrayType, DatabaseAdapter, SQLArrayParameter, SQLHelper, SQLResultArray, SSLMode } from "./shared";
const {
  SQLHelper,
  SSLMode,
  SQLResultArray,
  SQLArrayParameter,
  buildDefinedColumnsAndQuery,
} = require("internal/sql/shared");
const {
  Query,
  SQLQueryFlags,
  symbols: { _strings, _values, _flags, _results, _handle },
} = require("internal/sql/query");
function isTypedArray(value: any) {
  // Buffer should be treated as a normal object
  // Typed arrays should be treated like an array
  return ArrayBuffer.isView(value) && !Buffer.isBuffer(value);
}

const { PostgresError } = require("internal/sql/errors");

const {
  createConnection: createPostgresConnection,
  createQuery: createPostgresQuery,
  init: initPostgres,
} = $zig("postgres.zig", "createBinding") as PostgresDotZig;

const cmds = ["", "INSERT", "DELETE", "UPDATE", "MERGE", "SELECT", "MOVE", "FETCH", "COPY"];

const escapeBackslash = /\\/g;
const escapeQuote = /"/g;

function arrayEscape(value: string) {
  return value.replace(escapeBackslash, "\\\\").replace(escapeQuote, '\\"');
}
const POSTGRES_ARRAY_TYPES = {
  // Boolean
  1000: "BOOLEAN", // bool_array

  // Binary
  1001: "BYTEA", // bytea_array

  // Character types
  1002: "CHAR", // char_array
  1003: "NAME", // name_array
  1009: "TEXT", // text_array
  1014: "CHAR", // bpchar_array
  1015: "VARCHAR", // varchar_array

  // Numeric types
  1005: "SMALLINT", // int2_array
  1006: "INT2VECTOR", // int2vector_array
  1007: "INTEGER", // int4_array
  1016: "BIGINT", // int8_array
  1021: "REAL", // float4_array
  1022: "DOUBLE PRECISION", // float8_array
  1231: "NUMERIC", // numeric_array
  791: "MONEY", // money_array

  // OID types
  1028: "OID", // oid_array
  1010: "TID", // tid_array
  1011: "XID", // xid_array
  1012: "CID", // cid_array

  // JSON types
  199: "JSON", // json_array
  3802: "JSONB", // jsonb (not array)
  3807: "JSONB", // jsonb_array
  4072: "JSONPATH", // jsonpath
  4073: "JSONPATH", // jsonpath_array

  // XML
  143: "XML", // xml_array

  // Geometric types
  1017: "POINT", // point_array
  1018: "LSEG", // lseg_array
  1019: "PATH", // path_array
  1020: "BOX", // box_array
  1027: "POLYGON", // polygon_array
  629: "LINE", // line_array
  719: "CIRCLE", // circle_array

  // Network types
  651: "CIDR", // cidr_array
  1040: "MACADDR", // macaddr_array
  1041: "INET", // inet_array
  775: "MACADDR8", // macaddr8_array

  // Date/Time types
  1182: "DATE", // date_array
  1183: "TIME", // time_array
  1115: "TIMESTAMP", // timestamp_array
  1185: "TIMESTAMPTZ", // timestamptz_array
  1187: "INTERVAL", // interval_array
  1270: "TIMETZ", // timetz_array

  // Bit string types
  1561: "BIT", // bit_array
  1563: "VARBIT", // varbit_array

  // ACL
  1034: "ACLITEM", // aclitem_array

  // System catalog types
  12052: "PG_DATABASE", // pg_database_array
  10052: "PG_DATABASE", // pg_database_array2
};

function isPostgresNumericType(type: string) {
  switch (type) {
    case "BIT": // bit_array
    case "VARBIT": // varbit_array
    case "SMALLINT": // int2_array
    case "INT2VECTOR": // int2vector_array
    case "INTEGER": // int4_array
    case "INT": // int4_array
    case "BIGINT": // int8_array
    case "REAL": // float4_array
    case "DOUBLE PRECISION": // float8_array
    case "NUMERIC": // numeric_array
    case "MONEY": // money_array
      return true;
    default:
      return false;
  }
}
function isPostgresJsonType(type: string) {
  switch (type) {
    case "JSON":
    case "JSONB":
      return true;
    default:
      return false;
  }
}
function getPostgresArrayType(typeId: number) {
  return POSTGRES_ARRAY_TYPES[typeId] || null;
}

function arrayValueSerializer(type: ArrayType, is_numeric: boolean, is_json: boolean, value: any) {
  // we do minimal to none type validation, we just try to format nicely and let the server handle if is valid SQL
  // postgres will try to convert string -> array type
  // postgres will emit a nice error saying what value dont have the expected format outputing the value in the error
  if ($isArray(value) || isTypedArray(value)) {
    if (!value.length) return "{}";
    const delimiter = type === "BOX" ? ";" : ",";
    return `{${value.map(arrayValueSerializer.bind(this, type, is_numeric, is_json)).join(delimiter)}}`;
  }

  switch (typeof value) {
    case "undefined":
      return "null";
    case "string":
      if (is_json) {
        return `"${arrayEscape(JSON.stringify(value))}"`;
      }
      return `"${arrayEscape(value)}"`;

    case "bigint":
    case "number":
      if (is_numeric || is_json) {
        return "" + value;
      }
      return `"${value}"`;
    case "boolean":
      switch (type) {
        case "BOOLEAN":
          return value === true ? "t" : "f";
        case "JSON":
        case "JSONB":
          return value === true ? "true" : "false";
        default:
          if (is_numeric) {
            // convert to int if is a numeric array
            return "" + (value ? 1 : 0);
          }
          // fallback to string
          return value === true ? '"true"' : '"false"';
      }
    default:
      if (value instanceof Date) {
        const isoValue = value.toISOString();
        if (is_json) {
          return `"${arrayEscape(JSON.stringify(isoValue))}"`;
        }
        return `"${arrayEscape(isoValue)}"`;
      }
      if (Buffer.isBuffer(value)) {
        const hexValue = value.toString("hex");
        // bytea array
        if (type === "BYTEA") {
          return `"\\x${arrayEscape(hexValue)}"`;
        }
        if (is_json) {
          return `"${arrayEscape(JSON.stringify(hexValue))}"`;
        }
        return `"${arrayEscape(hexValue)}"`;
      }
      // fallback to JSON.stringify
      return `"${arrayEscape(JSON.stringify(value))}"`;
  }
}
function getArrayType(typeNameOrID: number | ArrayType | undefined = undefined): ArrayType {
  const typeOfType = typeof typeNameOrID;
  if (typeOfType === "number") {
    return getPostgresArrayType(typeNameOrID as number) ?? "JSON";
  }
  if (typeOfType === "string") {
    return (typeNameOrID as string)?.toUpperCase();
  }
  // default to JSON so we accept most of the types
  return "JSON";
}
function serializeArray(values: any[], type: ArrayType) {
  if (!$isArray(values) && !isTypedArray(values)) return values;

  if (!values.length) return "{}";

  // Only _box (1020) has the ';' delimiter for arrays, all other types use the ',' delimiter
  const delimiter = type === "BOX" ? ";" : ",";

  return `{${values.map(arrayValueSerializer.bind(this, type, isPostgresNumericType(type), isPostgresJsonType(type))).join(delimiter)}}`;
}

function wrapPostgresError(error: Error | PostgresErrorOptions) {
  if (Error.isError(error)) {
    return error;
  }
  return new PostgresError(error.message, error);
}

initPostgres(
  function onResolvePostgresQuery(query, result, commandTag, count, queries, is_last) {
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

  function onRejectPostgresQuery(
    query: Query<any, any>,
    reject: Error | PostgresErrorOptions,
    queries: Query<any, any>[],
  ) {
    reject = wrapPostgresError(reject);
    if (queries) {
      const queriesIndex = queries.indexOf(query);
      if (queriesIndex !== -1) {
        queries.splice(queriesIndex, 1);
      }
    }

    try {
      query.reject(reject as Error);
    } catch {}
  },
);

export interface PostgresDotZig {
  init: (
    onResolveQuery: (
      query: Query<any, any>,
      result: SQLResultArray,
      commandTag: string,
      count: number,
      queries: any,
      is_last: boolean,
    ) => void,
    onRejectQuery: (query: Query<any, any>, err: Error, queries) => void,
  ) => void;
  createConnection: (
    hostname: string | undefined,
    port: number,
    username: string,
    password: string,
    databae: string,
    sslmode: SSLMode,
    tls: Bun.TLSOptions | boolean | null | Bun.BunFile, // boolean true => empty TLSOptions object `{}`, boolean false or null => nothing
    query: string,
    path: string,
    onConnected: (err: Error | null, connection: $ZigGeneratedClasses.PostgresSQLConnection) => void,
    onDisconnected: (err: Error | null, connection: $ZigGeneratedClasses.PostgresSQLConnection) => void,
    idleTimeout: number,
    connectionTimeout: number,
    maxLifetime: number,
    useUnnamedPreparedStatements: boolean,
  ) => $ZigGeneratedClasses.PostgresSQLConnection;
  createQuery: (
    sql: string,
    values: unknown[],
    pendingValue: SQLResultArray,
    columns: string[] | undefined,
    bigint: boolean,
    simple: boolean,
  ) => $ZigGeneratedClasses.PostgresSQLQuery;
}

const enum SQLCommand {
  insert = 0,
  update = 1,
  updateSet = 2,
  where = 3,
  in = 4,
  none = -1,
}
export type { SQLCommand };

function commandToString(command: SQLCommand): string {
  switch (command) {
    case SQLCommand.insert:
      return "INSERT";
    case SQLCommand.updateSet:
    case SQLCommand.update:
      return "UPDATE";
    case SQLCommand.in:
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
  // we need to reverse search so we find the closest command to the parameter
  for (let i = text_len - 1; i >= 0; i--) {
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
            return SQLCommand.insert;
          }
          case "update": {
            return SQLCommand.update;
          }
          case "where": {
            return SQLCommand.where;
          }
          case "set": {
            return SQLCommand.updateSet;
          }
          case "in": {
            return SQLCommand.in;
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
          token = char + token;
        }
      }
    }
  }
  if (token) {
    switch (token) {
      case "insert":
        return SQLCommand.insert;
      case "update":
        return SQLCommand.update;
      case "where":
        return SQLCommand.where;
      case "set":
        return SQLCommand.updateSet;
      case "in":
        return SQLCommand.in;
      default:
        return SQLCommand.none;
    }
  }
  return command;
}

const enum PooledConnectionState {
  pending = 0,
  connected = 1,
  closed = 2,
}

const enum PooledConnectionFlags {
  /// canBeConnected is used to indicate that at least one time we were able to connect to the database
  canBeConnected = 1 << 0,
  /// reserved is used to indicate that the connection is currently reserved
  reserved = 1 << 1,
  /// preReserved is used to indicate that the connection will be reserved in the future when queryCount drops to 0
  preReserved = 1 << 2,
}

function onQueryFinish(this: PooledPostgresConnection, onClose: (err: Error) => void) {
  this.queries.delete(onClose);
  this.adapter.release(this);
}

async function resolvePostgresPassword(
  password: Bun.MaybePromise<string> | string | undefined | (() => Bun.MaybePromise<string>),
): Promise<string> {
  if (typeof password === "function") password = password();
  if (password && $isPromise(password)) password = await password;
  return (password as string) || "";
}

class PooledPostgresConnection {
  private static async createConnection(
    options: Bun.SQL.__internal.DefinedPostgresOrMySQLOptions,
    onConnected: (err: Error | null, connection: $ZigGeneratedClasses.PostgresSQLConnection) => void,
    onClose: (err: Error | null) => void,
  ): Promise<$ZigGeneratedClasses.PostgresSQLConnection | null> {
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

    try {
      const password = await resolvePostgresPassword(options.password);

      return createPostgresConnection(
        hostname,
        Number(port),
        username || "",
        password,
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
      );
    } catch (e) {
      onClose(e as Error);
      return null;
    }
  }

  adapter: PostgresAdapter;
  connection: $ZigGeneratedClasses.PostgresSQLConnection | null = null;
  state: PooledConnectionState = PooledConnectionState.pending;
  storedError: Error | null = null;
  queries: Set<(err: Error) => void> = new Set();
  onFinish: ((err: Error | null) => void) | null = null;
  connectionInfo: Bun.SQL.__internal.DefinedPostgresOrMySQLOptions;
  flags: number = 0;
  /// queryCount is used to indicate the number of queries using the connection, if a connection is reserved or if its a transaction queryCount will be 1 independently of the number of queries
  queryCount: number = 0;

  #onConnected(err, _) {
    if (err) {
      err = wrapPostgresError(err);
    }
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
    this.adapter.release(this, true);
  }

  #onClose(err) {
    if (err) {
      err = wrapPostgresError(err);
    }
    const connectionInfo = this.connectionInfo;
    if (connectionInfo?.onclose) {
      connectionInfo.onclose(err);
    }
    this.state = PooledConnectionState.closed;
    this.connection = null;
    this.storedError = err;

    // remove from ready connections if its there
    this.adapter.readyConnections?.delete(this);
    const queries = new Set(this.queries);
    this.queries?.clear?.();
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

    this.adapter.release(this, true);
  }

  constructor(connectionInfo: Bun.SQL.__internal.DefinedPostgresOrMySQLOptions, adapter: PostgresAdapter) {
    this.state = PooledConnectionState.pending;
    this.adapter = adapter;
    this.connectionInfo = connectionInfo;
    this.#startConnection();
  }

  async #startConnection() {
    this.connection = await PooledPostgresConnection.createConnection(
      this.connectionInfo,
      this.#onConnected.bind(this),
      this.#onClose.bind(this),
    );
  }

  onClose(onClose: (err: Error) => void) {
    this.queries.add(onClose);
  }

  bindQuery(query: Query<any, any>, onClose: (err: Error) => void) {
    this.queries.add(onClose);
    query.finally(onQueryFinish.bind(this, onClose));
  }

  #doRetry() {
    if (this.adapter.closed) {
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
    if (this.adapter.closed) {
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

class PostgresAdapter
  implements
    DatabaseAdapter<
      PooledPostgresConnection,
      $ZigGeneratedClasses.PostgresSQLConnection,
      $ZigGeneratedClasses.PostgresSQLQuery
    >
{
  public readonly connectionInfo: Bun.SQL.__internal.DefinedPostgresOrMySQLOptions;

  public readonly connections: PooledPostgresConnection[];
  public readonly readyConnections: Set<PooledPostgresConnection>;

  public waitingQueue: Array<(err: Error | null, result: any) => void> = [];
  public reservedQueue: Array<(err: Error | null, result: any) => void> = [];

  public poolStarted: boolean = false;
  public closed: boolean = false;
  public totalQueries: number = 0;
  public onAllQueriesFinished: (() => void) | null = null;

  constructor(connectionInfo: Bun.SQL.__internal.DefinedPostgresOrMySQLOptions) {
    this.connectionInfo = connectionInfo;
    this.connections = new Array(connectionInfo.max);
    this.readyConnections = new Set();
  }

  escapeIdentifier(str: string) {
    return '"' + str.replaceAll('"', '""').replaceAll(".", '"."') + '"';
  }

  connectionClosedError() {
    return new PostgresError("Connection closed", {
      code: "ERR_POSTGRES_CONNECTION_CLOSED",
    });
  }
  notTaggedCallError() {
    return new PostgresError("Query not called as a tagged template literal", {
      code: "ERR_POSTGRES_NOT_TAGGED_CALL",
    });
  }
  queryCancelledError(): Error {
    return new PostgresError("Query cancelled", {
      code: "ERR_POSTGRES_QUERY_CANCELLED",
    });
  }
  invalidTransactionStateError(message: string) {
    return new PostgresError(message, {
      code: "ERR_POSTGRES_INVALID_TRANSACTION_STATE",
    });
  }
  supportsReservedConnections() {
    return true;
  }

  getConnectionForQuery(pooledConnection: PooledPostgresConnection) {
    return pooledConnection.connection;
  }

  attachConnectionCloseHandler(connection: PooledPostgresConnection, handler: () => void): void {
    // PostgreSQL pooled connections support onClose handlers
    if (connection.onClose) {
      connection.onClose(handler);
    }
  }

  detachConnectionCloseHandler(connection: PooledPostgresConnection, handler: () => void): void {
    // PostgreSQL pooled connections track queries
    if (connection.queries) {
      connection.queries.delete(handler);
    }
  }

  array(values: any[], typeNameOrID?: number | ArrayType): SQLArrayParameter {
    const arrayType = getArrayType(typeNameOrID);
    return new SQLArrayParameter(serializeArray(values, arrayType), arrayType);
  }

  getTransactionCommands(options?: string): import("./shared").TransactionCommands {
    let BEGIN = "BEGIN";
    if (options) {
      BEGIN = `BEGIN ${options}`;
    }

    return {
      BEGIN,
      COMMIT: "COMMIT",
      ROLLBACK: "ROLLBACK",
      SAVEPOINT: "SAVEPOINT",
      RELEASE_SAVEPOINT: "RELEASE SAVEPOINT",
      ROLLBACK_TO_SAVEPOINT: "ROLLBACK TO SAVEPOINT",
    };
  }

  getDistributedTransactionCommands(name: string): import("./shared").TransactionCommands | null {
    if (!this.validateDistributedTransactionName(name).valid) {
      return null;
    }

    return {
      BEGIN: "BEGIN",
      COMMIT: `PREPARE TRANSACTION '${name}'`,
      ROLLBACK: "ROLLBACK",
      SAVEPOINT: "SAVEPOINT",
      RELEASE_SAVEPOINT: "RELEASE SAVEPOINT",
      ROLLBACK_TO_SAVEPOINT: "ROLLBACK TO SAVEPOINT",
      BEFORE_COMMIT_OR_ROLLBACK: null,
    };
  }

  validateTransactionOptions(_options: string): { valid: boolean; error?: string } {
    // PostgreSQL accepts any transaction options
    return { valid: true };
  }

  validateDistributedTransactionName(name: string): { valid: boolean; error?: string } {
    if (name.indexOf("'") !== -1) {
      return {
        valid: false,
        error: "Distributed transaction name cannot contain single quotes.",
      };
    }
    return { valid: true };
  }

  getCommitDistributedSQL(name: string): string {
    const validation = this.validateDistributedTransactionName(name);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    return `COMMIT PREPARED '${name}'`;
  }

  getRollbackDistributedSQL(name: string): string {
    const validation = this.validateDistributedTransactionName(name);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    return `ROLLBACK PREPARED '${name}'`;
  }

  createQueryHandle(sql: string, values: unknown[], flags: number) {
    if (!(flags & SQLQueryFlags.allowUnsafeTransaction)) {
      if (this.connectionInfo.max !== 1) {
        const upperCaseSqlString = sql.toUpperCase().trim();
        if (upperCaseSqlString.startsWith("BEGIN") || upperCaseSqlString.startsWith("START TRANSACTION")) {
          throw new PostgresError("Only use sql.begin, sql.reserved or max: 1", {
            code: "ERR_POSTGRES_UNSAFE_TRANSACTION",
          });
        }
      }
    }

    return createPostgresQuery(
      sql,
      values,
      new SQLResultArray(),
      undefined,
      !!(flags & SQLQueryFlags.bigint),
      !!(flags & SQLQueryFlags.simple),
    );
  }

  maxDistribution() {
    if (!this.waitingQueue.length) return 0;
    const result = Math.ceil((this.waitingQueue.length + this.totalQueries) / this.connections.length);
    return result ? result : 1;
  }

  flushConcurrentQueries() {
    const maxDistribution = this.maxDistribution();
    if (maxDistribution === 0) {
      return;
    }

    while (true) {
      const nonReservedConnections = Array.from(this.readyConnections || []).filter(
        c => !(c.flags & PooledConnectionFlags.preReserved) && c.queryCount < maxDistribution,
      );
      if (nonReservedConnections.length === 0) {
        return;
      }
      const orderedConnections = nonReservedConnections.sort((a, b) => a.queryCount - b.queryCount);
      for (const connection of orderedConnections) {
        const pending = this.waitingQueue.shift();
        if (!pending) {
          return;
        }
        connection.queryCount++;
        this.totalQueries++;
        pending(null, connection);
      }
    }
  }

  release(connection: PooledPostgresConnection, connectingEvent: boolean = false) {
    if (!connectingEvent) {
      connection.queryCount--;
      this.totalQueries--;
    }
    const currentQueryCount = connection.queryCount;
    if (currentQueryCount == 0) {
      connection.flags &= ~PooledConnectionFlags.reserved;
      connection.flags &= ~PooledConnectionFlags.preReserved;
    }
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

    if (currentQueryCount == 0) {
      // ok we can actually bind reserved queries to it
      const pendingReserved = this.reservedQueue.shift();
      if (pendingReserved) {
        connection.flags |= PooledConnectionFlags.reserved;
        connection.queryCount++;
        this.totalQueries++;
        // we have a connection waiting for a reserved connection lets prioritize it
        pendingReserved(connection.storedError, connection);
        return;
      }
    }
    this.readyConnections.add(connection);
    this.flushConcurrentQueries();
  }

  hasConnectionsAvailable() {
    if (this.readyConnections?.size > 0) return true;
    if (this.poolStarted) {
      const pollSize = this.connections.length;
      for (let i = 0; i < pollSize; i++) {
        const connection = this.connections[i];
        if (connection && connection.state !== PooledConnectionState.closed) {
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
      return this.totalQueries > 0;
    }
    return false;
  }
  isConnected() {
    if (this.readyConnections?.size > 0) {
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
      pending(this.connectionClosedError(), null);
    }
    while (this.reservedQueue.length > 0) {
      const pendingReserved = this.reservedQueue.shift();
      if (pendingReserved) {
        pendingReserved(this.connectionClosedError(), null);
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

  async close(options?: { timeout?: number }): Promise<void> {
    if (this.closed) {
      return;
    }

    this.#closeListen();

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

      const { promise, resolve } = Promise.withResolvers<void>();
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
      const { promise, resolve } = Promise.withResolvers<void>();

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
      return onConnected(this.connectionClosedError(), null);
    }

    if (!this.readyConnections || this.readyConnections.size === 0) {
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
          onConnected(storedError ?? this.connectionClosedError(), null);
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
      const firstConnection = new PooledPostgresConnection(this.connectionInfo, this);
      this.connections[0] = firstConnection;
      if (reserved) {
        firstConnection.flags |= PooledConnectionFlags.preReserved; // lets pre reserve the first connection
      }
      for (let i = 1; i < pollSize; i++) {
        this.connections[i] = new PooledPostgresConnection(this.connectionInfo, this);
      }
      return;
    }
    if (reserved) {
      let connectionWithLeastQueries: PooledPostgresConnection | null = null;
      let leastQueries = Infinity;
      for (const connection of this.readyConnections || []) {
        if (connection.flags & PooledConnectionFlags.preReserved || connection.flags & PooledConnectionFlags.reserved)
          continue;
        const queryCount = connection.queryCount;
        if (queryCount > 0) {
          if (queryCount < leastQueries) {
            leastQueries = queryCount;
            connectionWithLeastQueries = connection;
          }
          continue;
        }
        connection.flags |= PooledConnectionFlags.reserved;
        connection.queryCount++;
        this.totalQueries++;
        this.readyConnections?.delete(connection);
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

  normalizeQuery(strings: string | TemplateStringsArray, values: unknown[], binding_idx = 1): [string, unknown[]] {
    // This function handles array values in single fields:
    // - JSON/JSONB are the only field types that can be arrays themselves, so we serialize them
    // - SQL array field types (e.g., INTEGER[], TEXT[]) require the sql.array() helper
    // - All other types are handled natively

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
            const q = value as Query<any, any>;
            const [sub_query, sub_values] = this.normalizeQuery(q[_strings], q[_values], binding_idx);

            query += sub_query;
            for (let j = 0; j < sub_values.length; j++) {
              binding_values.push(sub_values[j]);
            }
            binding_idx += sub_values.length;
          } else if (value instanceof SQLHelper) {
            const command = detectCommand(query);
            // only selectIn, insert, update, updateSet are allowed
            if (command === SQLCommand.none || command === SQLCommand.where) {
              throw new SyntaxError("Helpers are only allowed for INSERT, UPDATE and IN commands");
            }
            const { columns, value: items } = value as SQLHelper;
            const columnCount = columns.length;
            if (columnCount === 0 && command !== SQLCommand.in) {
              throw new SyntaxError(`Cannot ${commandToString(command)} with no columns`);
            }
            const lastColumnIndex = columns.length - 1;

            if (command === SQLCommand.insert) {
              //
              // insert into users ${sql(users)} or insert into users ${sql(user)}
              //

              // Build column list while determining which columns have at least one defined value
              const { definedColumns, columnsSql } = buildDefinedColumnsAndQuery(
                columns,
                items,
                this.escapeIdentifier.bind(this),
              );

              const definedColumnCount = definedColumns.length;
              if (definedColumnCount === 0) {
                throw new SyntaxError("Insert needs to have at least one column with a defined value");
              }
              const lastDefinedColumnIndex = definedColumnCount - 1;

              query += columnsSql;
              if ($isArray(items)) {
                const itemsCount = items.length;
                const lastItemIndex = itemsCount - 1;
                for (let j = 0; j < itemsCount; j++) {
                  query += "(";
                  const item = items[j];
                  for (let k = 0; k < definedColumnCount; k++) {
                    const column = definedColumns[k];
                    const columnValue = item[column];
                    query += `$${binding_idx++}${k < lastDefinedColumnIndex ? ", " : ""}`;
                    // If this item has undefined for a column that other items defined, use null
                    binding_values.push(typeof columnValue === "undefined" ? null : columnValue);
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
                for (let j = 0; j < definedColumnCount; j++) {
                  const column = definedColumns[j];
                  const columnValue = item[column];
                  query += `$${binding_idx++}${j < lastDefinedColumnIndex ? ", " : ""}`;
                  binding_values.push(columnValue);
                }
                query += ") "; // the user can add RETURNING * or RETURNING id
              }
            } else if (command === SQLCommand.in) {
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
              let hasValues = false;
              for (let i = 0; i < columnCount; i++) {
                const column = columns[i];
                const columnValue = item[column];
                if (typeof columnValue === "undefined") {
                  // skip undefined values, this is the expected behavior in JS
                  continue;
                }
                hasValues = true;
                query += `${this.escapeIdentifier(column)} = $${binding_idx++}${i < lastColumnIndex ? ", " : ""}`;
                binding_values.push(columnValue);
              }
              if (query.endsWith(", ")) {
                // we got an undefined value at the end, lets remove the last comma
                query = query.substring(0, query.length - 2);
              }
              if (!hasValues) {
                throw new SyntaxError("Update needs to have at least one column");
              }
              // the user can add where clause after this
              query += " ";
            }
          } else if (value instanceof SQLArrayParameter) {
            query += `$${binding_idx++}::${value.arrayType}[] `;
            binding_values.push(value.serializedValues);
          } else {
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

  // --- LISTEN/NOTIFY ---
  // A single dedicated connection is created and reused for all listeners
  // on this adapter. It reconnects automatically with exponential backoff
  // (250ms → 32s) when the connection drops, and re-issues LISTEN for every
  // tracked channel. notify() goes through the regular pool via pg_notify().

  #listenConnection: $ZigGeneratedClasses.PostgresSQLConnection | null = null;
  #listenConnectPromise: Promise<$ZigGeneratedClasses.PostgresSQLConnection> | null = null;
  // Per-channel listener sets. The presence of a key means LISTEN should be
  // active for that channel on the dedicated connection.
  #listenChannels: Map<string, Set<(payload: string) => void>> = new Map();
  // Per-channel onlisten callbacks (fired on every successful LISTEN ack,
  // including reconnects).
  #listenOnlistenCallbacks: Map<string, Set<(state: { pid: number; secret: number }) => void>> = new Map();
  // Shared by concurrent listen() calls on the same channel so they all await
  // the same LISTEN ack instead of skipping it and resolving early.
  #listenInFlight: Map<string, Promise<void>> = new Map();
  #listenReconnectDelay: number = 250;
  #listenReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // Track consecutive per-channel LISTEN failures during reconnect. A channel
  // that fails this many times in a row is dropped to avoid an infinite retry
  // loop on a permanently-misconfigured channel.
  #listenChannelFailures: Map<string, number> = new Map();
  readonly #listenMaxChannelFailures: number = 10;
  // Shared state object returned from every listen() call. The same reference
  // is handed out to all listeners and mutated in-place on each (re)connect, so
  // user code holding `state` from a stale listen() always sees current pid/secret.
  // This matches the postgres.js `state.pid` shape but with auto-update semantics.
  #listenState: { pid: number; secret: number } = { pid: 0, secret: 0 };

  #closeListen() {
    if (this.#listenReconnectTimer) {
      clearTimeout(this.#listenReconnectTimer);
      this.#listenReconnectTimer = null;
    }
    const conn = this.#listenConnection;
    this.#listenConnection = null;
    // The in-flight create promise self-clears via .finally(), but null it here
    // for symmetry so post-close synchronous reads don't see a stale promise.
    this.#listenConnectPromise = null;
    this.#listenChannels.clear();
    this.#listenOnlistenCallbacks.clear();
    this.#listenChannelFailures.clear();
    this.#listenInFlight.clear();
    this.#listenReconnectDelay = 250;
    // Intentionally do NOT zero #listenState here — user code holding a `state`
    // reference from a previous listen() should be able to inspect the last-known
    // pid/secret after close (e.g. to log "shut down on backend N"). The next
    // (re)connect overwrites these in place.
    if (conn) {
      try {
        conn.close();
      } catch {}
    }
  }

  async #createListenConnection(): Promise<$ZigGeneratedClasses.PostgresSQLConnection> {
    const info = this.connectionInfo;
    const password = await resolvePostgresPassword(info.password);

    // If close() ran while we were resolving the password, bail out.
    if (this.closed) throw this.connectionClosedError();

    const { promise, resolve, reject } = Promise.withResolvers<$ZigGeneratedClasses.PostgresSQLConnection>();
    createPostgresConnection(
      info.hostname,
      Number(info.port),
      info.username || "",
      password,
      info.database || "",
      info.sslMode || SSLMode.disable,
      info.tls || null,
      info.query || "",
      info.path || "",
      (err, conn) => {
        if (err) {
          reject(wrapPostgresError(err));
          return;
        }
        // If close() ran while the native side was connecting, the adapter
        // is gone — close the orphan connection rather than leaking it.
        if (this.closed) {
          try {
            conn.close();
          } catch {}
          reject(this.connectionClosedError());
          return;
        }
        this.#listenConnection = conn;
        this.#listenReconnectDelay = 250;
        // Mutate the shared #listenState in place so every previously-returned
        // listen() result sees the new connection's pid/secret on reconnect.
        const connWithIds = conn as unknown as { processId: number; secretKey: number };
        this.#listenState.pid = connWithIds.processId;
        this.#listenState.secret = connWithIds.secretKey;
        // Generated `.d.ts` marks `onnotification` readonly because the codegen
        // produces a getter regardless of setter presence (same for onclose/onconnect).
        // The Zig setter exists; cast through a writable shape rather than `any`.
        (conn as { onnotification: (channel: string, payload: string) => void }).onnotification = (
          channel: string,
          payload: string,
        ) => this.#dispatchNotification(channel, payload);
        conn.ref();
        resolve(conn);
      },
      _err => {
        this.#listenConnection = null;
        this.#scheduleListenReconnect();
      },
      0, // idleTimeout: never time out — listen connection must stay open
      info.connectionTimeout ?? 30000,
      0, // maxLifetime: never recycle
      false, // useUnnamedPreparedStatements: irrelevant; only LISTEN/UNLISTEN run here
    );
    return promise;
  }

  async #ensureListenConnection(): Promise<$ZigGeneratedClasses.PostgresSQLConnection> {
    if (this.#listenConnection) return this.#listenConnection;
    if (!this.#listenConnectPromise) {
      this.#listenConnectPromise = this.#createListenConnection().finally(() => {
        this.#listenConnectPromise = null;
      });
    }
    return this.#listenConnectPromise;
  }

  #dispatchNotification(channel: string, payload: string) {
    const listeners = this.#listenChannels.get(channel);
    if (!listeners) return;
    for (const fn of listeners) {
      try {
        fn.$call(undefined, payload);
      } catch {}
    }
  }

  #scheduleListenReconnect() {
    // Reconnect retries indefinitely as long as there are tracked channels and
    // the adapter is open. There is no global attempt cap — if PG is permanently
    // down, this will keep firing every ≤32s forever (capped delay below). Stops
    // immediately when:
    //   - the adapter is closed (#closeListen clears channels and the timer), or
    //   - the last channel is unlistened (#listenChannels becomes empty), or
    //   - all permanently-failing channels exceed #listenMaxChannelFailures and get
    //     dropped, draining #listenChannels.
    // This matches postgres.js, which also retries indefinitely.
    if (this.closed || this.#listenChannels.size === 0 || this.#listenReconnectTimer) return;
    // Apply ±25% jitter (multiplier in [0.75, 1.25]) to the base delay to avoid
    // synchronized retry storms when many adapters in the same process lose their
    // listen connection at once.
    const jitter = 0.75 + Math.random() * 0.5;
    const delayMs = Math.max(1, Math.floor(this.#listenReconnectDelay * jitter));
    this.#listenReconnectTimer = setTimeout(async () => {
      this.#listenReconnectTimer = null;
      if (this.closed || this.#listenChannels.size === 0) return;
      // Snapshot before any await so #closeListen() cannot clear the map under us.
      const channels = Array.from(this.#listenChannels.keys());
      let anyChannelFailed = false;
      try {
        const conn = await this.#ensureListenConnection();
        for (const channel of channels) {
          // Channel may have been unlistened while we awaited the connection.
          if (!this.#listenChannels.has(channel)) continue;
          try {
            await this.#runListenQuery(conn, `LISTEN ${this.#quoteChannel(channel)}`);
            const failures = this.#listenChannelFailures.get(channel);
            if (failures !== undefined) this.#listenChannelFailures.delete(channel);
            const onlistens = this.#listenOnlistenCallbacks.get(channel);
            if (onlistens) {
              for (const fn of onlistens) {
                try {
                  fn.$call(undefined, this.#listenState);
                } catch {}
              }
            }
          } catch (err) {
            // Per-channel LISTEN failed on a live connection (transient PG error,
            // permissions blip, etc). Surface the error and track consecutive
            // failures — drop the channel after #listenMaxChannelFailures so we
            // don't retry forever for a permanently-misconfigured channel.
            const failures = (this.#listenChannelFailures.get(channel) ?? 0) + 1;
            this.#listenChannelFailures.set(channel, failures);
            const errMsg = (err as Error)?.message ?? String(err);
            if (failures >= this.#listenMaxChannelFailures) {
              console.warn(
                `bun:sql LISTEN to channel "${channel}" failed ${failures} times in a row; ` +
                  `giving up and removing the subscription. Last error: ${errMsg}`,
              );
              this.#listenChannels.delete(channel);
              this.#listenOnlistenCallbacks.delete(channel);
              this.#listenChannelFailures.delete(channel);
            } else {
              console.warn(
                `bun:sql LISTEN to channel "${channel}" failed (attempt ${failures}/${this.#listenMaxChannelFailures}): ${errMsg}`,
              );
              anyChannelFailed = true;
            }
          }
        }
        if (anyChannelFailed && this.#listenChannels.size > 0) {
          // Connection is alive but at least one channel did not register.
          // Schedule another tick; PG tolerates duplicate LISTENs as no-ops.
          this.#listenReconnectDelay = Math.min(this.#listenReconnectDelay * 2, 32000);
          this.#scheduleListenReconnect();
        } else {
          // All channels reconnected successfully — reset backoff for the next failure.
          this.#listenReconnectDelay = 250;
        }
      } catch {
        this.#listenReconnectDelay = Math.min(this.#listenReconnectDelay * 2, 32000);
        this.#scheduleListenReconnect();
      }
    }, delayMs);
  }

  // PG channel identifiers must be double-quoted to preserve case and allow
  // characters outside the unquoted-identifier grammar; embedded `"` doubles up.
  #quoteChannel(channel: string): string {
    return `"${channel.replaceAll('"', '""')}"`;
  }

  async #runListenQuery(conn: $ZigGeneratedClasses.PostgresSQLConnection, sql: string): Promise<void> {
    const pendingValue = new SQLResultArray();
    const handle = createPostgresQuery(sql, [], pendingValue, undefined, false, true);
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    // Fake query object — bypasses the user-facing Query class because LISTEN/UNLISTEN
    // don't fit the tagged-template path (no result rows, no Promise interface needed).
    //
    // CONTRACT (must stay in sync with src/js/internal/sql/postgres.ts initPostgres):
    //   onResolvePostgresQuery (this file, ~line 237):
    //     - is_last branch:    reads `query[_results]`, calls `query.resolve(...)`.
    //                          May call `queries.indexOf(query)`+`splice` IF the
    //                          connection has a JS-cached `queries` array — the
    //                          dedicated listen connection does not, so this branch
    //                          is skipped.
    //     - !is_last branch:   reads `query[_handle]`, calls `setPendingValue` on it,
    //                          mutates `query[_results]`. LISTEN/UNLISTEN produce a
    //                          single CommandComplete + ReadyForQuery so this is not
    //                          reached in practice — but we delegate setPendingValue
    //                          to the real native handle just in case.
    //   onRejectPostgresQuery (this file, ~line 300):
    //     - calls `query.reject(err)`. May call `queries.indexOf(query)` (same
    //       no-op as above for the listen connection).
    //
    // If either callback grows to access more fields (e.g. `query.cancel?.()`,
    // `query.done()`, etc.), those fields MUST be added here or LISTEN/UNLISTEN
    // will silently break. The native side never references this object directly —
    // it only flows through the two JS callbacks above.
    handle.run(conn, {
      resolve: () => resolve(),
      reject: (err: any) => reject(wrapPostgresError(err)),
      [_results]: null,
      [_handle]: {
        setPendingValue: (v: SQLResultArray) => handle.setPendingValue(v),
      },
    });
    return promise;
  }

  async listen(
    channel: string,
    onnotify: (payload: string) => void,
    onlisten?: (state: { pid: number; secret: number }) => void,
  ): Promise<{ state: { pid: number; secret: number }; unlisten: () => Promise<void> }> {
    if (typeof channel !== "string" || !channel)
      throw $ERR_INVALID_ARG_VALUE("channel", channel, "must be a non-empty string");
    if (channel.indexOf("\0") !== -1) throw $ERR_INVALID_ARG_VALUE("channel", channel, "must not contain null bytes");
    if (!$isCallable(onnotify)) throw $ERR_INVALID_ARG_TYPE("onnotify", "function", onnotify);
    if (onlisten !== undefined && !$isCallable(onlisten)) throw $ERR_INVALID_ARG_TYPE("onlisten", "function", onlisten);

    if (!this.#listenChannels.has(channel)) this.#listenChannels.set(channel, new Set());
    this.#listenChannels.get(channel)!.add(onnotify);

    if (onlisten) {
      if (!this.#listenOnlistenCallbacks.has(channel)) this.#listenOnlistenCallbacks.set(channel, new Set());
      this.#listenOnlistenCallbacks.get(channel)!.add(onlisten);
    }

    try {
      // Always issue LISTEN (idempotent server-side) and share the in-flight
      // promise so concurrent callers can't resolve before the ack and can't
      // miss the case where the connection dropped mid-handoff.
      let inFlight = this.#listenInFlight.get(channel);
      if (!inFlight) {
        inFlight = (async () => {
          const conn = await this.#ensureListenConnection();
          await this.#runListenQuery(conn, `LISTEN ${this.#quoteChannel(channel)}`);
        })().finally(() => {
          if (this.#listenInFlight.get(channel) === inFlight) this.#listenInFlight.delete(channel);
        });
        this.#listenInFlight.set(channel, inFlight);
      }
      await inFlight;
    } catch (err) {
      // Roll back only the registrations this call made — siblings keep theirs.
      const set = this.#listenChannels.get(channel);
      set?.delete(onnotify);
      if (onlisten) {
        const onlistens = this.#listenOnlistenCallbacks.get(channel);
        onlistens?.delete(onlisten);
        if (onlistens && onlistens.size === 0) this.#listenOnlistenCallbacks.delete(channel);
      }
      if (set && set.size === 0) {
        this.#listenChannels.delete(channel);
        this.#listenOnlistenCallbacks.delete(channel);
      }
      throw err;
    }

    try {
      onlisten?.(this.#listenState);
    } catch {}

    // unlistened is checked then set synchronously inside the closure; no await
    // sits between the check and the assignment, so two simultaneous calls on a
    // single isolate cannot both pass the gate. If an `await` is ever introduced
    // before the flag flip, this becomes a TOCTOU bug — be careful.
    let unlistened = false;
    return {
      state: this.#listenState,
      unlisten: async () => {
        if (unlistened) return;
        unlistened = true;
        // Drop this caller's onlisten — unlisten(channel, onnotify) only clears
        // onlistenCallbacks on full teardown, so siblings would keep firing it.
        if (onlisten) {
          const onlistens = this.#listenOnlistenCallbacks.get(channel);
          onlistens?.delete(onlisten);
          if (onlistens && onlistens.size === 0) this.#listenOnlistenCallbacks.delete(channel);
        }
        await this.unlisten(channel, onnotify);
      },
    };
  }

  async unlisten(channel: string, onnotify?: (payload: string) => void): Promise<void> {
    if (typeof channel !== "string" || !channel)
      throw $ERR_INVALID_ARG_VALUE("channel", channel, "must be a non-empty string");
    if (channel.indexOf("\0") !== -1) throw $ERR_INVALID_ARG_VALUE("channel", channel, "must not contain null bytes");
    if (onnotify !== undefined && !$isCallable(onnotify)) throw $ERR_INVALID_ARG_TYPE("onnotify", "function", onnotify);

    if (!onnotify) {
      this.#listenChannels.delete(channel);
      this.#listenOnlistenCallbacks.delete(channel);
      this.#listenChannelFailures.delete(channel);
    } else {
      this.#listenChannels.get(channel)?.delete(onnotify);
      if (this.#listenChannels.get(channel)?.size === 0) {
        this.#listenChannels.delete(channel);
        this.#listenOnlistenCallbacks.delete(channel);
        this.#listenChannelFailures.delete(channel);
      }
    }

    if (this.#listenConnection && !this.#listenChannels.has(channel)) {
      await this.#runListenQuery(this.#listenConnection, `UNLISTEN ${this.#quoteChannel(channel)}`);
    }
  }
}

export default {
  PostgresAdapter,
  SQLCommand,
  commandToString,
  detectCommand,
};
