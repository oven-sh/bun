export const enum QueryStatus {
  active = 1 << 1,
  cancelled = 1 << 2,
  error = 1 << 3,
  executed = 1 << 4,
  invalidHandle = 1 << 5,
}

export const enum SQLQueryResultMode {
  objects = 0,
  values = 1,
  raw = 2,
}

export const enum SQLCommand {
  none = 0,
  insert = 1,
  update = 2,
  updateSet = 3,
  where = 4,
  whereIn = 5,
}

export const enum SQLQueryFlags {
  none = 0,
  unsafe = 1 << 1,
  notTagged = 1 << 2,
  simple = 1 << 3,
  bigint = 1 << 4,
  allowUnsafeTransaction = 1 << 5,
}

export type TransactionCallback = (sql: SQLTagFn) => Promise<any>;

export interface QueryLike {
  readonly strings: string | TemplateStringsArray;
  readonly values: any[];
  readonly flags: SQLQueryFlags;
  __executionType?: "all" | "get" | "run" | "values" | "raw";

  resolve(value: any): void;
  reject(reason?: any): void;
  getUnderlyingHandle(): any;
  setUnderlyingHandle(handle: any): void;
}

export interface QueryAdapter {
  normalizeQuery(
    strings: string | TemplateStringsArray,
    values: any[],
    queryInstance: QueryLike
  ): [string, any[]];
  createQueryHandle(
    sqlString: string,
    params: any[],
    flags: SQLQueryFlags,
    queryInstance: QueryLike
  ): any;
  executeQuery(queryInstance: QueryLike): Promise<void>;
  cancelQuery(queryInstance: QueryLike): void;
  releaseHandle(queryInstance: QueryLike): void;
  setResultMode(queryInstance: QueryLike, mode: SQLQueryResultMode): void;

  begin(options?: string): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  savepoint(name: string): Promise<void>;
  releaseSavepoint(name: string): Promise<void>;
  rollbackToSavepoint(name: string): Promise<void>;
  close(options?: { timeout?: number }): Promise<void>;
  getConnectionInfo(): any;
  getSQLTagFn(): SQLTagFn;
}

export type SQLTagFn = {
  (
    strings: string | TemplateStringsArray,
    ...values: any[]
  ): BaseQuery<QueryAdapter>;
  unsafe(query: string, params?: any[]): BaseQuery<QueryAdapter>;
  file(path: string, params?: any[]): Promise<BaseQuery<QueryAdapter>>;
  begin(
    optionsOrFn: string | TransactionCallback,
    fn?: TransactionCallback
  ): Promise<any>;
  beginDistributed(name: string, fn: TransactionCallback): Promise<any>;
  commitDistributed(name: string): Promise<any>;
  rollbackDistributed(name: string): Promise<any>;
  reserve(): Promise<ReservedSQL>;
  close(options?: { timeout?: number }): Promise<void>;
  options: any;
};

export interface ReservedSQL extends SQLTagFn {
  release(): Promise<void>;
  "Symbol.asyncDispose"?(): Promise<void>;
  "Symbol.dispose"?(): void;
}

export declare abstract class BaseQuery<
  AdapterType extends QueryAdapter
> extends Promise<any> {
}
