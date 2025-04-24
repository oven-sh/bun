declare module "bun" {
  /** @deprecated Use BunFile instead */
  interface FileBlob extends BunFile {}

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

  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
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

  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
  type TimerHandler = (...args: any[]) => void;

  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
  type DOMHighResTimeStamp = number;

  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
  type EventListenerOrEventListenerObject = EventListener | EventListenerObject;

  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
  type ReadableStreamReader<T> = ReadableStreamDefaultReader<T>;

  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
  type MultipleResolveType = "resolve" | "reject";

  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
  type ReadableStreamController<T> = ReadableStreamDefaultController<T>;

  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
  type ReadableStreamDefaultReadResult<T> =
    | ReadableStreamDefaultReadValueResult<T>
    | ReadableStreamDefaultReadDoneResult;

  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
  type MessageEventSource = undefined;

  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
  type Architecture = "arm" | "arm64" | "ia32" | "mips" | "mipsel" | "ppc" | "ppc64" | "s390" | "s390x" | "x64";

  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
  type UncaughtExceptionOrigin = "uncaughtException" | "unhandledRejection";

  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
  type UncaughtExceptionListener = (error: Error, origin: UncaughtExceptionOrigin) => void;

  /**
   * Most of the time the unhandledRejection will be an Error, but this should not be relied upon
   * as *anything* can be thrown/rejected, it is therefore unsafe to assume that the value is an Error.
   *
   * @deprecated This type is unused in Bun's types and might be removed in the near future
   */
  type UnhandledRejectionListener = (reason: unknown, promise: Promise<unknown>) => void;

  /** @deprecated This type is unused in Bun's types and might be removed in the near future */
  type MultipleResolveListener = (type: MultipleResolveType, promise: Promise<unknown>, value: unknown) => void;

  /**
   * @deprecated This type is unused in Bun's types and might be removed in the near future
   */
  type BeforeExitListener = (code: number) => void;

  /**
   * @deprecated This type is unused in Bun's types and might be removed in the near future
   */
  type DisconnectListener = () => void;

  /**
   * @deprecated This type is unused in Bun's types and might be removed in the near future
   */
  type ExitListener = (code: number) => void;

  /**
   * @deprecated This type is unused in Bun's types and might be removed in the near future
   */
  type RejectionHandledListener = (promise: Promise<unknown>) => void;

  /**
   * @deprecated This type is unused in Bun's types and might be removed in the near future
   */
  type WarningListener = (warning: Error) => void;

  /**
   * @deprecated This type is unused in Bun's types and might be removed in the near future
   */
  type MessageListener = (message: unknown, sendHandle: unknown) => void;

  /**
   * @deprecated This type is unused in Bun's types and might be removed in the near future
   */
  type SignalsListener = (signal: NodeJS.Signals) => void;

  /**
   * @deprecated This type is redundant with built-in types. Consider using {@link Bun.BodyInit} instead.
   */
  type XMLHttpRequestBodyInit = Blob | BufferSource | string | FormData | Iterable<Uint8Array>;
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
