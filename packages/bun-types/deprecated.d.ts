declare module "bun" {
  /** @deprecated Unused in Bun's types and may be removed */
  type Platform =
    | "aix"
    | "android"
    | "darwin"
    | "freebsd"
    | "haiku"
    | "linux"
    | "openbsd"
    | "sunos"
    | "win32"
    | "cygwin"
    | "netbsd";

  /** @deprecated Unused in Bun's types and may be removed */
  type Architecture = "arm" | "arm64" | "ia32" | "mips" | "mipsel" | "ppc" | "ppc64" | "s390" | "s390x" | "x64";

  /** @deprecated Unused in Bun's types and may be removed */
  type UncaughtExceptionListener = (error: Error, origin: UncaughtExceptionOrigin) => void;

  /**
   * The reason is usually an Error, but *anything* can be thrown or rejected, so
   * don't assume the value is an Error.
   *
   * @deprecated Unused in Bun's types and may be removed
   */
  type UnhandledRejectionListener = (reason: unknown, promise: Promise<unknown>) => void;

  /** @deprecated Unused in Bun's types and may be removed */
  type MultipleResolveListener = (type: MultipleResolveType, promise: Promise<unknown>, value: unknown) => void;

  /**
   * Consumes all data from a {@link ReadableStream} until it closes or errors.
   *
   * Concatenates the chunks into a single {@link Uint8Array}.
   *
   * Each chunk must be a TypedArray or an ArrayBuffer. If you need to support
   * chunks of different types, consider {@link readableStreamToBlob}.
   *
   * @param stream The stream to consume.
   * @returns The concatenated chunks as a {@link Uint8Array}, or a promise that resolves with them.
   *
   * @deprecated Use {@link ReadableStream.bytes}
   */
  function readableStreamToBytes(
    stream: ReadableStream<ArrayBufferView | ArrayBufferLike>,
  ): Promise<Uint8Array<ArrayBuffer>> | Uint8Array<ArrayBuffer>;

  /**
   * Consumes all data from a {@link ReadableStream} until it closes or errors.
   *
   * Concatenates the chunks into a single {@link Blob}.
   *
   * @param stream The stream to consume.
   * @returns A promise that resolves with the concatenated chunks as a {@link Blob}.
   *
   * @deprecated Use {@link ReadableStream.blob}
   */
  function readableStreamToBlob(stream: ReadableStream): Promise<Blob>;

  /**
   * Consumes all data from a {@link ReadableStream} until it closes or errors.
   *
   * Concatenates the chunks into a single string. Each chunk must be a TypedArray or an ArrayBuffer. If you need to support chunks of different types, consider {@link readableStreamToBlob}.
   *
   * @param stream The stream to consume.
   * @returns A promise that resolves with the concatenated chunks as a {@link String}.
   *
   * @deprecated Use {@link ReadableStream.text}
   */
  function readableStreamToText(stream: ReadableStream): Promise<string>;

  /**
   * Consumes all data from a {@link ReadableStream} until it closes or errors.
   *
   * Concatenates the chunks into a single string and parses it as JSON. Each chunk must be a TypedArray or an ArrayBuffer. If you need to support chunks of different types, consider {@link readableStreamToBlob}.
   *
   * @param stream The stream to consume.
   * @returns A promise that resolves with the concatenated chunks parsed as JSON.
   *
   * @deprecated Use {@link ReadableStream.json}
   */
  function readableStreamToJSON(stream: ReadableStream): Promise<any>;

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

  /**
   * @deprecated Use {@link Serve.Options Bun.Serve.Options<T, R>} instead
   */
  type ServeOptions<T = undefined, R extends string = never> = Serve.Options<T, R>;

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

  /** @deprecated Unused in Bun's types and may be removed */
  type ShellFunction = (input: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

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
     * File path to a .pem file for a custom root CA
     *
     * @deprecated since v0.6.3 - Use `ca: Bun.file(path)` instead.
     */
    caFile?: string;
  }

  /** @deprecated Unused in Bun's types and may be removed */
  type ReadableIO = ReadableStream<Uint8Array<ArrayBuffer>> | number | undefined;
}

declare namespace NodeJS {
  interface Process {
    /**
     * @deprecated Use the `node:assert` module instead.
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
