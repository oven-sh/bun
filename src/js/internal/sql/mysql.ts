import type { NativeCreateConnection, NativeCreateQuery } from "./pool";
import type { Query } from "./query";
import type { SQLStatementDescription, TransactionCommands } from "./shared";

type SQLResultArray<T> = import("./shared").SQLResultArray<T>;

const { SQLResultArray } = require("internal/sql/shared");
// The cast: the checker reports a class that extends a member of the generic `require` as its own base (TS2506).
const { BaseSQLAdapter, addResult, onRejectQuery } = require("internal/sql/pool") as typeof import("./pool").default;
const {
  symbols: { _results, _handle },
} = require("internal/sql/query");
const { MySQLError } = require("internal/sql/errors");

const {
  createConnection: createMySQLConnection,
  createQuery: createMySQLQuery,
  init: initMySQL,
} = $bindgen("mysql.bind.ts", "binding") as MySQLDotZig;

initMySQL(function onResolveMySQLQuery(query, result, count, is_last, last_insert_rowid, affected_rows, statement) {
  $assert(result instanceof SQLResultArray, "Invalid result array");

  result.count = count || affected_rows || 0;
  result.lastInsertRowid = last_insert_rowid;
  result.affectedRows = affected_rows || 0;
  SQLResultArray.describe(result, query[_handle], statement);
  addResult(query, result);

  // until the server clears SERVER_MORE_RESULTS_EXISTS
  if (!is_last) {
    // The native side swaps the pending value out for js_undefined before
    // invoking this callback; re-prime so the follow-up result set lands in
    // a fresh array.
    query[_handle].setPendingValue(new SQLResultArray());
    return;
  }

  query.resolve(query[_results]);
}, onRejectQuery);

interface MySQLDotZig {
  init: (
    onResolveQuery: (
      query: Query<any, any>,
      result: SQLResultArray<unknown>,
      count: number,
      is_last: boolean,
      last_insert_rowid: number | string | bigint,
      affected_rows: number,
      statement: SQLStatementDescription | number | null,
    ) => void,
    onRejectQuery: (query: Query<any, any>, err: Error) => void,
  ) => void;
  createConnection: NativeCreateConnection<$Bindgen.MySQLConnection>;
  createQuery: NativeCreateQuery<$Bindgen.MySQLQuery>;
}

class MySQLAdapter extends BaseSQLAdapter<$Bindgen.MySQLConnection, $Bindgen.MySQLQuery> {
  readonly createNativeConnection = createMySQLConnection;
  protected readonly createNativeQuery = createMySQLQuery;
  readonly ErrorClass = MySQLError;
  readonly codePrefix = "ERR_MYSQL_";
  readonly quote = "`";
  readonly begin = "START TRANSACTION";
  protected readonly commitPrepared = "XA COMMIT";
  protected readonly rollbackPrepared = "XA ROLLBACK";

  array(): never {
    throw new Error("MySQL doesn't support arrays");
  }

  getDistributedTransactionCommands(name: string): TransactionCommands | null {
    this.checkDistributedName(name);
    return {
      BEGIN: `XA START '${name}'`,
      BEFORE_COMMIT_OR_ROLLBACK: `XA END '${name}'`,
      COMMIT: `XA PREPARE '${name}'`,
      ROLLBACK: `XA ROLLBACK '${name}'`,
    };
  }
}

export default {
  MySQLAdapter,
};
