import { QueryAdapter, QueryLike, QueryStatus, SQLQueryFlags, SQLQueryResultMode } from "./SQLTypes";

declare const $markPromiseAsHandled: ((promise: Promise<any>) => void) | undefined;

export const symbols = {
  adapter: Symbol("adapter"),
  status: Symbol("status"),
  flags: Symbol("flags"),
  strings: Symbol("strings"),
  values: Symbol("values"),
  underlyingHandle: Symbol("underlyingHandle"),
  resolve: Symbol("resolve"),
  reject: Symbol("reject"),
  run: Symbol("run"),
  handler: Symbol("handler"),
  results: Symbol("results"),
} as const;

export abstract class BaseQuery<AdapterType extends QueryAdapter> extends Promise<any> implements QueryLike {
  private _adapter!: AdapterType;
  private _status: QueryStatus = QueryStatus.active;
  private _flags!: SQLQueryFlags;
  private _strings!: string | TemplateStringsArray;
  private _values!: any[];
  private _underlyingHandle: any = null;
  private _resolve!: (value: any) => void;
  private _reject!: (reason?: any) => void;
  private _handler!: (query: BaseQuery<AdapterType>, handle: any, err?: Error) => Promise<any>;
  private _results: any = null;

  public get strings() {
    return this._strings;
  }
  public get values() {
    return this._values;
  }
  public get flags() {
    return this._flags;
  }
  public __executionType?: "all" | "get" | "run" | "values" | "raw";

  constructor(
    strings: string | TemplateStringsArray,
    values: any[],
    initialFlags: SQLQueryFlags,
    adapter: AdapterType,
    handler: (query: BaseQuery<AdapterType>, handle: any, err?: Error) => Promise<any>,
  ) {
    let resolvePromise!: (value: any) => void;
    let rejectPromise!: (reason?: any) => void;
    super((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    this._adapter = adapter;
    this._flags = initialFlags;
    this._strings = strings;
    this._values = values;
    this._resolve = resolvePromise;
    this._reject = rejectPromise;
    this._handler = handler;

    const [normalizedSql, normalizedParams] = adapter.normalizeQuery(strings, values, this);
    this._underlyingHandle = adapter.createQueryHandle(normalizedSql, normalizedParams, this._flags, this);
  }

  getUnderlyingHandle(): any {
    return this._underlyingHandle;
  }
  setUnderlyingHandle(handle: any): void {
    this._underlyingHandle = handle;
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null,
  ): Promise<TResult1 | TResult2> {
    this[symbols.run](true); // true for async execution path
    const promise = super.then(onfulfilled, onrejected);
    if (typeof $markPromiseAsHandled !== "undefined") {
      $markPromiseAsHandled(promise);
    }
    return promise;
  }

  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null,
  ): Promise<any | TResult> {
    this[symbols.run](true);
    const promise = super.catch(onrejected);
    if (typeof $markPromiseAsHandled !== "undefined") {
      $markPromiseAsHandled(promise);
    }
    return promise;
  }

  finally(onfinally?: (() => void) | undefined | null): Promise<any> {
    this[symbols.run](true);
    return super.finally(onfinally);
  }

  execute(): this {
    this[symbols.run](false); // false for sync/immediate execution path
    return this;
  }

  raw(): this {
    this.__executionType = "raw";
    this._adapter.setResultMode(this, SQLQueryResultMode.raw);
    return this;
  }

  valuesMode(): this {
    this.__executionType = "values";
    this._adapter.setResultMode(this, SQLQueryResultMode.values);
    return this;
  }

  get(): this {
    this.__executionType = "get";
    this._adapter.setResultMode(this, SQLQueryResultMode.objects);
    return this;
  }

  all(): this {
    this.__executionType = "all";
    this._adapter.setResultMode(this, SQLQueryResultMode.objects);
    return this;
  }

  run(): this {
    this.__executionType = "run";
    return this;
  }

  simple(): this {
    this._flags |= SQLQueryFlags.simple;
    return this;
  }

  cancel(): this {
    if (this._status & QueryStatus.cancelled) {
      return this;
    }
    this._status |= QueryStatus.cancelled;
    this._adapter.cancelQuery(this);
    return this;
  }

  resolve(value: any): void {
    if (this._status & (QueryStatus.error | QueryStatus.cancelled)) return;
    this._status = (this._status & ~QueryStatus.active) | QueryStatus.executed;
    this._adapter.releaseHandle(this);
    this._resolve(value);
  }

  reject(reason?: any): void {
    if (this._status & QueryStatus.error) return; // Already rejected
    this._status = (this._status & ~QueryStatus.active) | QueryStatus.error;
    if (!(this._status & QueryStatus.invalidHandle)) {
      this._adapter.releaseHandle(this);
    }
    this._reject(reason);
  }

  async [symbols.run](isAsync: boolean): Promise<void> {
    if (this._status & (QueryStatus.executed | QueryStatus.error | QueryStatus.cancelled | QueryStatus.invalidHandle)) {
      return;
    }
    if (this._flags & SQLQueryFlags.notTagged) {
      this.reject(new Error("Query not called as a tagged template literal")); // Generic error, adapter-specific in postgres_adapter
      return;
    }
    this._status |= QueryStatus.executed;

    if (isAsync) {
      await undefined; // Ensure async execution
    }

    try {
      await this._adapter.executeQuery(this);
    } catch (err) {
      if (!(this._status & (QueryStatus.error | QueryStatus.cancelled))) {
        this.reject(err);
      }
    }
  }

  static get [Symbol.species]() {
    return Promise;
  }

  [Symbol.toStringTag]() {
    return "Query";
  }

  [Symbol.for("nodejs.util.inspect.custom")]() {
    const status = this[symbols.status];
    const active = (status & QueryStatus.active) != 0;
    const cancelled = (status & QueryStatus.cancelled) != 0;
    const executed = (status & QueryStatus.executed) != 0;
    const error = (status & QueryStatus.error) != 0;
    return `Query { ${active ? "active" : ""} ${
      cancelled ? "cancelled" : ""
    } ${executed ? "executed" : ""} ${error ? "error" : ""} }`;
  }
}
