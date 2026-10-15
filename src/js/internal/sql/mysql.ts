import type { Query } from "./query";
import type { SSLMode } from "./options";
import type { ArrayType, DatabaseAdapter, SQLArrayParameter, SQLStatementDescription } from "./shared";

type SQLResultArray<T> = import("./shared").SQLResultArray<T>;

const { SQLResultArray } = require("internal/sql/shared");
const { BasePooledConnection, BaseSQLAdapter, createPooledConnectionHandle } = require("internal/sql/pool");
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

initMySQL(
  function onResolveMySQLQuery(query, result, count, is_last, last_insert_rowid, affected_rows, statement) {
    $assert(result instanceof SQLResultArray, "Invalid result array");

    result.count = count || affected_rows || 0;
    result.lastInsertRowid = last_insert_rowid;
    result.affectedRows = affected_rows || 0;
    result.statement = statement;

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

    try {
      query.resolve(query[_results]);
    } catch {}
  },

  function onRejectMySQLQuery(query: Query<any, any>, reject: Error) {
    try {
      query.reject(reject);
    } catch {}
  },
);

export interface MySQLDotZig {
  init: (
    onResolveQuery: (
      query: Query<any, any>,
      result: SQLResultArray<unknown>,
      count: number,
      is_last: boolean,
      last_insert_rowid: number | string | bigint,
      affected_rows: number,
      statement: SQLStatementDescription | null,
    ) => void,
    onRejectQuery: (query: Query<any, any>, err: Error) => void,
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
  ) => $ZigGeneratedClasses.MySQLConnection;
  createQuery: (
    sql: string,
    values: unknown[],
    pendingValue: SQLResultArray<unknown>,
    bigint: boolean,
    simple: boolean,
  ) => $ZigGeneratedClasses.MySQLQuery;
}

class PooledMySQLConnection extends BasePooledConnection<$ZigGeneratedClasses.MySQLConnection> {
  protected async startConnection() {
    this.connection = await createPooledConnectionHandle(
      createMySQLConnection,
      this.adapter.connectionInfo,
      this.nativeCallback(this.handleConnected),
      this.nativeCallback(this.handleClose),
      this.nativeCallback(this.handleRetire),
      this,
    );
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
    return new PooledMySQLConnection(this);
  }

  escapeIdentifier(str: string) {
    if (str.includes("\0")) {
      throw $ERR_INVALID_ARG_VALUE("name", str, "must not contain null bytes");
    }
    return "`" + str.replaceAll("`", "``").replaceAll(".", "`.`") + "`";
  }

  connectionClosedError() {
    return new MySQLError("Connection closed", {
      code: "ERR_MYSQL_CONNECTION_CLOSED",
    });
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
      !!(flags & SQLQueryFlags.bigint),
      !!(flags & SQLQueryFlags.simple),
    );
  }
}

export default {
  MySQLAdapter,
};
