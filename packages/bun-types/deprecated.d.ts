declare module "bun" {
  interface BunMessageEvent<T> {
    /**
     * @deprecated
     */
    initMessageEvent(
      type: string,
      bubbles?: boolean,
      cancelable?: boolean,
      data?: any,
      origin?: string,
      lastEventId?: string,
      source?: null,
    ): void;
  }

  /** @deprecated Use {@link SQL.Query Bun.SQL.Query} */
  type SQLQuery<T = any> = SQL.Query<T>;

  /** @deprecated Use {@link SQL.TransactionContextCallback Bun.SQL.TransactionContextCallback} */
  type SQLTransactionContextCallback<T> = SQL.TransactionContextCallback<T>;

  /** @deprecated Use {@link SQL.SavepointContextCallback Bun.SQL.SavepointContextCallback} */
  type SQLSavepointContextCallback<T> = SQL.SavepointContextCallback<T>;

  /** @deprecated Use {@link SQL.Options Bun.SQL.Options} */
  type SQLOptions = SQL.Options;

  /**
   * @deprecated Renamed to `ErrorLike`
   */
  type Errorlike = ErrorLike;

  interface TLSOptions {
    /**
     * File path to a TLS key
     *
     * To enable TLS, this option is required.
     *
     * @deprecated since v0.6.3 - Use `key: Bun.file(path)` instead.
     */
    keyFile?: string;

    /**
     * File path to a TLS certificate
     *
     * To enable TLS, this option is required.
     *
     * @deprecated since v0.6.3 - Use `cert: Bun.file(path)` instead.
     */
    certFile?: string;

    /**
     *  File path to a .pem file for a custom root CA
     *
     * @deprecated since v0.6.3 - Use `ca: Bun.file(path)` instead.
     */
    caFile?: string;
  }

  /** @deprecated This type is unused in Bun's declarations and may be removed in the future */
  type ReadableIO = ReadableStream<Uint8Array> | number | undefined;
}

declare namespace NodeJS {
  interface Process {
    /**
     * @deprecated This is deprecated; use the "node:assert" module instead.
     */
    assert(value: unknown, message?: string | Error): asserts value;
  }
}

interface CustomEvent<T = any> {
  /** @deprecated */
  initCustomEvent(type: string, bubbles?: boolean, cancelable?: boolean, detail?: T): void;
}

interface DOMException {
  /** @deprecated */
  readonly code: number;
}

/**
 * @deprecated Renamed to `BuildMessage`
 */
declare var BuildError: typeof BuildMessage;

/**
 * @deprecated Renamed to `ResolveMessage`
 */
declare var ResolveError: typeof ResolveMessage;
