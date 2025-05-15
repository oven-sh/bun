import {
  QueryAdapter, QueryLike, SQLQueryResultMode, SQLQueryFlags, BaseQuery,
  TransactionCallback, SQLTagFn, ReservedSQL, QueryStatus
} from "./SQLTypes";
import { SQLResultArray } from "./SQLResultArray";
import { symbols } from "./BaseQuery";
import { 
  SQLArrayParameter, 
  normalizeQuery as commonNormalizeQuery, 
  escapeIdentifier, 
  detectCommand, 
  commandToString 
} from "./SQLHelpers";

const enum SSLMode {
  disable = 0,
  prefer = 1,
  require = 2,
  verify_ca = 3,
  verify_full = 4,
}

declare const $zig: any;
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

declare const $ERR_POSTGRES_CONNECTION_CLOSED: any;
declare const $ERR_POSTGRES_NOT_TAGGED_CALL: any;
declare const $ERR_INVALID_ARG_VALUE: any;

function connectionClosedError() {
  return $ERR_POSTGRES_CONNECTION_CLOSED("Connection closed");
}

function notTaggedCallError() {
  return $ERR_POSTGRES_NOT_TAGGED_CALL("Query not called as a tagged template literal");
}

export interface PostgresAdapter extends QueryAdapter {}

export class PostgresQuery extends BaseQuery<PostgresAdapter> {
}

export class PostgresAdapter implements QueryAdapter {
  private connectionInfo: any;
  private pool: any;

  constructor(options: any) {
    this.connectionInfo = this.loadOptions(options);
    this.pool = new ConnectionPool(this.connectionInfo);
    
    init();
  }

  normalizeQuery(
    strings: string | TemplateStringsArray,
    values: any[],
    queryInstance: QueryLike
  ): [string, any[]] {
    return commonNormalizeQuery(strings, values, this);
  }

  createQueryHandle(
    sqlString: string,
    params: any[],
    flags: SQLQueryFlags,
    queryInstance: QueryLike
  ): any {
    return createQuery(sqlString, params, flags & SQLQueryFlags.simple);
  }

  executeQuery(queryInstance: QueryLike): Promise<void> {
    return Promise.resolve();
  }

  cancelQuery(queryInstance: QueryLike): void {
    const handle = queryInstance.getUnderlyingHandle();
    if (handle) {
      handle.cancel();
    }
  }

  releaseHandle(queryInstance: QueryLike): void {
    const handle = queryInstance.getUnderlyingHandle();
    if (handle) {
      handle.done();
    }
  }

  setResultMode(queryInstance: QueryLike, mode: SQLQueryResultMode): void {
    const handle = queryInstance.getUnderlyingHandle();
    if (handle) {
      handle.setMode(mode);
    }
  }

  begin(options?: string): Promise<void> {
    return Promise.resolve();
  }

  commit(): Promise<void> {
    return Promise.resolve();
  }

  rollback(): Promise<void> {
    return Promise.resolve();
  }

  savepoint(name: string): Promise<void> {
    return Promise.resolve();
  }

  releaseSavepoint(name: string): Promise<void> {
    return Promise.resolve();
  }

  rollbackToSavepoint(name: string): Promise<void> {
    return Promise.resolve();
  }

  close(options?: { timeout?: number }): Promise<void> {
    return Promise.resolve();
  }

  getConnectionInfo(): any {
    return this.connectionInfo;
  }

  getSQLTagFn(): SQLTagFn {
    return {} as SQLTagFn;
  }

  private loadOptions(options: any): any {
    return options;
  }
}

class ConnectionPool {
  constructor(connectionInfo: any) {
  }
}
