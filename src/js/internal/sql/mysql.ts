import type { MySQLErrorOptions } from "internal/sql/errors";
import type { Query } from "./query";
import type { ArrayType, DatabaseAdapter, SQLArrayParameter, SQLCommand, SQLResultArray, SSLMode } from "./shared";
const {
  SQLResultArray,
  BasePooledConnection,
  BaseSQLAdapter,
  createPooledConnectionHandle,
  getHelperCommandFromDetect,
} = require("internal/sql/shared");
const {
  SQLQueryFlags,
  symbols: { _results, _handle },
} = require("internal/sql/query");
const { MySQLError } = require("internal/sql/errors");

const {
  createConnection: createMySQLConnection,
  createQuery: createMySQLQuery,
  init: initMySQL,
} = $rust("mysql.rs", "createBinding") as MySQLDotZig;

function wrapError(error: Error | MySQLErrorOptions) {
  if (Error.isError(error)) {
    return error;
  }
  return new MySQLError(error.message, error);
}
initMySQL(
  function onResolveMySQLQuery(query, result, commandTag, count, queries, is_last, last_insert_rowid, affected_rows) {
    $assert(result instanceof SQLResultArray, "Invalid result array");

    result.count = count || 0;
    result.lastInsertRowid = last_insert_rowid;
    result.affectedRows = affected_rows || 0;

    // CALL <proc>() and multi-statement strings can yield several result sets.
    // Accumulate until the server clears SERVER_MORE_RESULTS_EXISTS (is_last).
    const lastResult = query[_results];
    if (!lastResult) {
      query[_results] = result;
    } else if (lastResult instanceof SQLResultArray) {
      query[_results] = [lastResult, result];
    } else {
      lastResult.push(result);
    }

    if (!is_last) {
      // The native side swaps the pending value out for js_undefined before
      // invoking this callback; re-prime so the follow-up result set lands in
      // a fresh array.
      query[_handle].setPendingValue(new SQLResultArray());
      return;
    }

    if (queries) {
      const queriesIndex = queries.indexOf(query);
      if (queriesIndex !== -1) {
        queries.splice(queriesIndex, 1);
      }
    }
    try {
      query.resolve(query[_results]);
    } catch {}
  },

  function onRejectMySQLQuery(query: Query<any, any>, reject: Error | MySQLErrorOptions, queries: Query<any, any>[]) {
    reject = wrapError(reject);
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

export interface MySQLDotZig {
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
    onConnected: (err: Error | null, connection: $ZigGeneratedClasses.MySQLConnection) => void,
    onDisconnected: (err: Error | null, connection: $ZigGeneratedClasses.MySQLConnection) => void,
    idleTimeout: number,
    connectionTimeout: number,
    maxLifetime: number,
    useUnnamedPreparedStatements: boolean,
    allowPublicKeyRetrieval: boolean,
  ) => $ZigGeneratedClasses.MySQLConnection;
  createQuery: (
    sql: string,
    values: unknown[],
    pendingValue: SQLResultArray,
    columns: string[] | undefined,
    bigint: boolean,
    simple: boolean,
  ) => $ZigGeneratedClasses.MySQLQuery;
}

class PooledMySQLConnection extends BasePooledConnection<$ZigGeneratedClasses.MySQLConnection> {
  protected handleConnected(err: any, connection?: $ZigGeneratedClasses.MySQLConnection) {
    if (!err) {
      this.connection = connection!;
    }
    super.handleConnected(err);
  }

  protected async startConnection() {
    // store the handle right away (not only in handleConnected) so a forced
    // pool close can tear down a connection whose handshake is in flight
    this.connection = await createPooledConnectionHandle(
      createMySQLConnection,
      this.connectionInfo,
      this.handleConnected.bind(this),
      this.handleClose.bind(this),
    );
  }

  protected wrapError(error: any): Error {
    return wrapError(error);
  }

  protected isNonRetryableError(code: string | undefined): boolean {
    switch (code) {
      case "ERR_MYSQL_PASSWORD_REQUIRED":
      case "ERR_MYSQL_MISSING_AUTH_DATA":
      case "ERR_MYSQL_FAILED_TO_ENCRYPT_PASSWORD":
      case "ERR_MYSQL_INVALID_PUBLIC_KEY":
      case "ERR_MYSQL_UNSUPPORTED_PROTOCOL_VERSION":
      case "ERR_MYSQL_UNSUPPORTED_AUTH_PLUGIN":
      case "ERR_MYSQL_AUTHENTICATION_FAILED":
        // we can't retry these are authentication errors
        return true;
      default:
        return false;
    }
  }

  /// Connect failures (ERR_MYSQL_CONNECTION_FAILED) mean the server accepted
  /// the TCP connection but closed it before the handshake completed,
  /// typically because it is still starting up or an intermediary (like a
  /// container port proxy) is up before the database is. Those are retried
  /// until connectionTimeout elapses, as long as queries are waiting on the
  /// pool. Refused connections (ERR_MYSQL_CONNECTION_REFUSED) fail fast:
  /// nothing is listening, and probes/healthchecks rely on the immediate
  /// error. Real server errors (authentication, handshake errors) and closes
  /// of established connections are not retried here.
  protected isConnectFailureError(err: Error | null): boolean {
    return err instanceof MySQLError && (err as any).code === "ERR_MYSQL_CONNECTION_FAILED";
  }
}

class MySQLAdapter
  extends BaseSQLAdapter<PooledMySQLConnection, $ZigGeneratedClasses.MySQLConnection, $ZigGeneratedClasses.MySQLQuery>
  implements
    DatabaseAdapter<PooledMySQLConnection, $ZigGeneratedClasses.MySQLConnection, $ZigGeneratedClasses.MySQLQuery>
{
  protected createPooledConnection(): PooledMySQLConnection {
    return new PooledMySQLConnection(this.connectionInfo, this);
  }

  escapeIdentifier(str: string) {
    return "`" + str.replaceAll("`", "``") + "`";
  }

  connectionClosedError() {
    return new MySQLError("Connection closed", {
      code: "ERR_MYSQL_CONNECTION_CLOSED",
    });
  }
  acquisitionTimeoutError(ms: number, max: number) {
    return new MySQLError(
      `Connection timeout after ${ms}ms: no connection in the pool of ${max} became available. Ensure reserved connections are released, or raise \`max\` / \`connectionTimeout\`.`,
      { code: "ERR_MYSQL_CONNECTION_TIMEOUT" },
    );
  }
  notTaggedCallError() {
    return new MySQLError("Query not called as a tagged template literal", {
      code: "ERR_MYSQL_NOT_TAGGED_CALL",
    });
  }
  queryCancelledError() {
    return new MySQLError("Query cancelled", {
      code: "ERR_MYSQL_QUERY_CANCELLED",
    });
  }
  invalidTransactionStateError(message: string) {
    return new MySQLError(message, {
      code: "ERR_MYSQL_INVALID_TRANSACTION_STATE",
    });
  }
  unsafeTransactionError() {
    return new MySQLError("Only use sql.begin, sql.reserved or max: 1", {
      code: "ERR_MYSQL_UNSAFE_TRANSACTION",
    });
  }

  array(_values: any[], _typeNameOrID?: number | ArrayType): SQLArrayParameter {
    throw new Error("MySQL doesn't support arrays");
  }
  getTransactionCommands(options?: string): import("./shared").TransactionCommands {
    let BEGIN = "START TRANSACTION";
    if (options) {
      BEGIN = `START TRANSACTION ${options}`;
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
      BEGIN: `XA START '${name}'`,
      COMMIT: `XA PREPARE '${name}'`,
      ROLLBACK: `XA ROLLBACK '${name}'`,
      SAVEPOINT: "SAVEPOINT",
      RELEASE_SAVEPOINT: "RELEASE SAVEPOINT",
      ROLLBACK_TO_SAVEPOINT: "ROLLBACK TO SAVEPOINT",
      BEFORE_COMMIT_OR_ROLLBACK: `XA END '${name}'`,
    };
  }

  getCommitDistributedSQL(name: string): string {
    const validation = this.validateDistributedTransactionName(name);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    return `XA COMMIT '${name}'`;
  }

  getRollbackDistributedSQL(name: string): string {
    const validation = this.validateDistributedTransactionName(name);
    if (!validation.valid) {
      throw new Error(validation.error);
    }
    return `XA ROLLBACK '${name}'`;
  }

  createQueryHandle(sql: string, values: unknown[], flags: number) {
    this.checkUnsafeTransaction(sql, flags);

    return createMySQLQuery(
      sql,
      values,
      new SQLResultArray(),
      undefined,
      !!(flags & SQLQueryFlags.bigint),
      !!(flags & SQLQueryFlags.simple),
    );
  }

  getHelperCommand(query: string): SQLCommand {
    return getHelperCommandFromDetect(query, true);
  }

  isUpsertUpdate(query: string): boolean {
    return query.trimEnd().endsWith("ON DUPLICATE KEY UPDATE");
  }
}

export default {
  MySQLAdapter,
};
