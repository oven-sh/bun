import type { PostgresErrorOptions } from "internal/sql/errors";
import type { Query } from "./query";
import type { ArrayType, DatabaseAdapter, SQLArrayParameter, SQLCommand, SQLResultArray, SSLMode } from "./shared";
const {
  SQLResultArray,
  SQLArrayParameter,
  BasePooledConnection,
  BaseSQLAdapter,
  createPooledConnectionHandle,
  getHelperCommandFromDetect,
  pushBindParam,
} = require("internal/sql/shared");
const {
  SQLQueryFlags,
  symbols: { _results, _handle },
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
} = $rust("postgres.rs", "createBinding") as PostgresDotZig;

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
    const type = (typeNameOrID as string).toUpperCase();
    // Allow `NUMERIC(10,2)`, `CHARACTER VARYING(255)`, `MYSCHEMA.MY_ENUM`,
    // `TIMESTAMP(3) WITH TIME ZONE`: identifier words separated by spaces or
    // dots, each optionally followed by a `(digits[,digits])` modifier.
    // Parentheses may only wrap digit lists so the value can never close the
    // enclosing expression and break out of the `$N::${type}[]` cast.
    if (
      !/^[A-Z_][A-Z0-9_]*(\( *[0-9]+( *, *[0-9]+)* *\))?([ .][A-Z_][A-Z0-9_]*(\( *[0-9]+( *, *[0-9]+)* *\))?)*$/.test(
        type,
      )
    ) {
      throw $ERR_INVALID_ARG_VALUE("type", typeNameOrID, "must be a valid PostgreSQL type name");
    }
    return type;
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
  function onResolvePostgresQuery(query, result, commandTag, count, queries, is_last, statement) {
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
    if (statement) {
      result.statement = statement;
      result.columns = statement.columns;
    }
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
      statement: Bun.SQL.ResultStatement | undefined,
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

class PooledPostgresConnection extends BasePooledConnection<$ZigGeneratedClasses.PostgresSQLConnection> {
  protected async startConnection() {
    this.connection = await createPooledConnectionHandle(
      createPostgresConnection,
      this.connectionInfo,
      this.handleConnected.bind(this),
      this.handleClose.bind(this),
    );
  }

  protected wrapError(error: any): Error {
    return wrapPostgresError(error);
  }

  protected isNonRetryableError(code: string | undefined): boolean {
    switch (code) {
      case "ERR_POSTGRES_UNSUPPORTED_AUTHENTICATION_METHOD":
      case "ERR_POSTGRES_UNKNOWN_AUTHENTICATION_METHOD":
      case "ERR_POSTGRES_TLS_NOT_AVAILABLE":
      case "ERR_POSTGRES_TLS_UPGRADE_FAILED":
      case "ERR_POSTGRES_INVALID_SERVER_SIGNATURE":
      case "ERR_POSTGRES_INVALID_SERVER_KEY":
      case "ERR_POSTGRES_AUTHENTICATION_FAILED_PBKDF2":
        // we can't retry these are authentication errors
        return true;
      default:
        return false;
    }
  }

  /// Connect failures (ERR_POSTGRES_CONNECTION_FAILED) mean the server
  /// accepted the TCP connection but closed it before the handshake
  /// completed, typically because it is still starting up or an intermediary
  /// (like a container port proxy) is up before the database is. Those are
  /// retried until connectionTimeout elapses, as long as queries are waiting
  /// on the pool. Refused connections (ERR_POSTGRES_CONNECTION_REFUSED) fail
  /// fast: nothing is listening, and probes/healthchecks rely on the
  /// immediate error. Real server errors (authentication, ErrorResponse
  /// during startup) and closes of established connections are not retried
  /// here.
  protected isConnectFailureError(err: Error | null): boolean {
    return err instanceof PostgresError && (err as any).code === "ERR_POSTGRES_CONNECTION_FAILED";
  }
}

class PostgresAdapter
  extends BaseSQLAdapter<
    PooledPostgresConnection,
    $ZigGeneratedClasses.PostgresSQLConnection,
    $ZigGeneratedClasses.PostgresSQLQuery
  >
  implements
    DatabaseAdapter<
      PooledPostgresConnection,
      $ZigGeneratedClasses.PostgresSQLConnection,
      $ZigGeneratedClasses.PostgresSQLQuery
    >
{
  protected createPooledConnection(): PooledPostgresConnection {
    return new PooledPostgresConnection(this.connectionInfo, this);
  }

  escapeIdentifier(str: string) {
    if (str.includes("\0")) {
      throw $ERR_INVALID_ARG_VALUE("name", str, "must not contain null bytes");
    }
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
  unsafeTransactionError() {
    return new PostgresError("Only use sql.begin, sql.reserved or max: 1", {
      code: "ERR_POSTGRES_UNSAFE_TRANSACTION",
    });
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
    this.checkUnsafeTransaction(sql, flags);

    return createPostgresQuery(
      sql,
      values,
      new SQLResultArray(),
      undefined,
      !!(flags & SQLQueryFlags.bigint),
      !!(flags & SQLQueryFlags.simple),
    );
  }

  getHelperCommand(query: string): SQLCommand {
    return getHelperCommandFromDetect(query, false);
  }

  placeholder(index: number): string {
    return "$" + index;
  }

  bindParam(value: unknown, binding_values: unknown[], index: number): string {
    if (value instanceof SQLArrayParameter) {
      binding_values.push(value.serializedValues);
      return `$${index}::${value.arrayType}[] `;
    }
    return pushBindParam(this, value, binding_values, index);
  }
}

export default {
  PostgresAdapter,
};
