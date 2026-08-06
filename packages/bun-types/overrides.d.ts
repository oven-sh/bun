export {};

/**
 * Like a `BodyMixin`, but implemented by more types, such as
 * `Blob`, `ReadableStream`, and `Response`.
 *
 * It has no `blob()` method because it's the lowest common
 * denominator of these objects: a `Blob` in Bun does not have a
 * `.blob()` method.
 */
interface BunConsumerConvenienceMethods {
  /**
   * Consume as text
   */
  text(): Promise<string>;

  /**
   * Consume as a Uint8Array, backed by an ArrayBuffer
   */
  bytes(): Promise<Uint8Array<ArrayBuffer>>;

  /**
   * Consume as JSON
   */
  json(): Promise<any>;
}

declare module "stream/web" {
  interface ReadableStream extends BunConsumerConvenienceMethods {
    /**
     * Consume as a Blob
     */
    blob(): Promise<Blob>;
  }
}

declare module "buffer" {
  interface Blob extends BunConsumerConvenienceMethods {
    // We have to specify bytes again even though it comes from
    // BunConsumerConvenienceMethods, because inheritance in TypeScript is
    // slightly different from just "copying in the methods" (the difference is
    // related to how type parameters are resolved)
    bytes(): Promise<Uint8Array<ArrayBuffer>>;

    /**
     * Consume the blob as a FormData instance
     */
    formData(): Promise<FormData>;

    /**
     * Consume the blob as an ArrayBuffer
     */
    arrayBuffer(): Promise<ArrayBuffer>;

    /**
     * Wrap this blob in a {@link Bun.Image} pipeline.
     * Equivalent to `new Bun.Image(this, options)`.
     */
    image(options?: Bun.Image.ConstructorOptions): Bun.Image;

    /**
     * Returns a readable stream of the blob's contents
     */
    stream(): ReadableStream<Uint8Array<ArrayBuffer>>;
  }
}

declare module "url" {
  interface URLSearchParams {
    toJSON(): Record<string, string>;
  }
}

declare global {
  namespace NodeJS {
    interface ProcessEnv extends Bun.Env {}

    interface Process {
      readonly version: string;
      browser: boolean;

      /**
       * Always `true` in Bun. Use it to detect whether code is running in Bun.
       */
      isBun: true;

      /**
       * The git commit SHA that Bun was built from
       */
      revision: string;

      reallyExit(code?: number): never;
      dlopen(module: { exports: any }, filename: string, flags?: number): void;
      _exiting: boolean;
      noDeprecation?: boolean | undefined;

      /**
       * Emitted when the operating system signals that available memory is
       * running low. Use this to release caches or reap idle resources instead
       * of polling.
       *
       * On macOS `level` distinguishes `"warning"` from `"critical"` based on
       * the kernel's memorystatus thresholds. On Linux (PSI) and Windows the
       * event is always emitted with `"critical"`. On Linux, the underlying
       * PSI trigger requires `CAP_SYS_RESOURCE` on kernels before 6.6; when
       * unavailable the event is never emitted.
       *
       * This listener does not keep the event loop alive.
       */
      on(event: "memoryPressure", listener: (level: "warning" | "critical") => void): this;
      once(event: "memoryPressure", listener: (level: "warning" | "critical") => void): this;
      off(event: "memoryPressure", listener: (level: "warning" | "critical") => void): this;
      addListener(event: "memoryPressure", listener: (level: "warning" | "critical") => void): this;
      removeListener(event: "memoryPressure", listener: (level: "warning" | "critical") => void): this;
      prependListener(event: "memoryPressure", listener: (level: "warning" | "critical") => void): this;
      prependOnceListener(event: "memoryPressure", listener: (level: "warning" | "critical") => void): this;
      emit(event: "memoryPressure", level: "warning" | "critical"): boolean;

      binding(m: "constants"): {
        os: typeof import("node:os").constants;
        fs: typeof import("node:fs").constants;
        crypto: typeof import("node:crypto").constants;
        zlib: typeof import("node:zlib").constants;
        trace: {
          TRACE_EVENT_PHASE_BEGIN: number;
          TRACE_EVENT_PHASE_END: number;
          TRACE_EVENT_PHASE_COMPLETE: number;
          TRACE_EVENT_PHASE_INSTANT: number;
          TRACE_EVENT_PHASE_ASYNC_BEGIN: number;
          TRACE_EVENT_PHASE_ASYNC_STEP_INTO: number;
          TRACE_EVENT_PHASE_ASYNC_STEP_PAST: number;
          TRACE_EVENT_PHASE_ASYNC_END: number;
          TRACE_EVENT_PHASE_NESTABLE_ASYNC_BEGIN: number;
          TRACE_EVENT_PHASE_NESTABLE_ASYNC_END: number;
          TRACE_EVENT_PHASE_NESTABLE_ASYNC_INSTANT: number;
          TRACE_EVENT_PHASE_FLOW_BEGIN: number;
          TRACE_EVENT_PHASE_FLOW_STEP: number;
          TRACE_EVENT_PHASE_FLOW_END: number;
          TRACE_EVENT_PHASE_METADATA: number;
          TRACE_EVENT_PHASE_COUNTER: number;
          TRACE_EVENT_PHASE_SAMPLE: number;
          TRACE_EVENT_PHASE_CREATE_OBJECT: number;
          TRACE_EVENT_PHASE_SNAPSHOT_OBJECT: number;
          TRACE_EVENT_PHASE_DELETE_OBJECT: number;
          TRACE_EVENT_PHASE_MEMORY_DUMP: number;
          TRACE_EVENT_PHASE_MARK: number;
          TRACE_EVENT_PHASE_CLOCK_SYNC: number;
          TRACE_EVENT_PHASE_ENTER_CONTEXT: number;
          TRACE_EVENT_PHASE_LEAVE_CONTEXT: number;
          TRACE_EVENT_PHASE_LINK_IDS: number;
        };
      };
      binding(m: "uv"): {
        errname(code: number): string;
        UV_E2BIG: number;
        UV_EACCES: number;
        UV_EADDRINUSE: number;
        UV_EADDRNOTAVAIL: number;
        UV_EAFNOSUPPORT: number;
        UV_EAGAIN: number;
        UV_EAI_ADDRFAMILY: number;
        UV_EAI_AGAIN: number;
        UV_EAI_BADFLAGS: number;
        UV_EAI_BADHINTS: number;
        UV_EAI_CANCELED: number;
        UV_EAI_FAIL: number;
        UV_EAI_FAMILY: number;
        UV_EAI_MEMORY: number;
        UV_EAI_NODATA: number;
        UV_EAI_NONAME: number;
        UV_EAI_OVERFLOW: number;
        UV_EAI_PROTOCOL: number;
        UV_EAI_SERVICE: number;
        UV_EAI_SOCKTYPE: number;
        UV_EALREADY: number;
        UV_EBADF: number;
        UV_EBUSY: number;
        UV_ECANCELED: number;
        UV_ECHARSET: number;
        UV_ECONNABORTED: number;
        UV_ECONNREFUSED: number;
        UV_ECONNRESET: number;
        UV_EDESTADDRREQ: number;
        UV_EEXIST: number;
        UV_EFAULT: number;
        UV_EFBIG: number;
        UV_EHOSTUNREACH: number;
        UV_EINTR: number;
        UV_EINVAL: number;
        UV_EIO: number;
        UV_EISCONN: number;
        UV_EISDIR: number;
        UV_ELOOP: number;
        UV_EMFILE: number;
        UV_EMSGSIZE: number;
        UV_ENAMETOOLONG: number;
        UV_ENETDOWN: number;
        UV_ENETUNREACH: number;
        UV_ENFILE: number;
        UV_ENOBUFS: number;
        UV_ENODEV: number;
        UV_ENOENT: number;
        UV_ENOMEM: number;
        UV_ENONET: number;
        UV_ENOPROTOOPT: number;
        UV_ENOSPC: number;
        UV_ENOSYS: number;
        UV_ENOTCONN: number;
        UV_ENOTDIR: number;
        UV_ENOTEMPTY: number;
        UV_ENOTSOCK: number;
        UV_ENOTSUP: number;
        UV_EOVERFLOW: number;
        UV_EPERM: number;
        UV_EPIPE: number;
        UV_EPROTO: number;
        UV_EPROTONOSUPPORT: number;
        UV_EPROTOTYPE: number;
        UV_ERANGE: number;
        UV_EROFS: number;
        UV_ESHUTDOWN: number;
        UV_ESPIPE: number;
        UV_ESRCH: number;
        UV_ETIMEDOUT: number;
        UV_ETXTBSY: number;
        UV_EXDEV: number;
        UV_UNKNOWN: number;
        UV_EOF: number;
        UV_ENXIO: number;
        UV_EMLINK: number;
        UV_EHOSTDOWN: number;
        UV_EREMOTEIO: number;
        UV_ENOTTY: number;
        UV_EFTYPE: number;
        UV_EILSEQ: number;
        UV_ESOCKTNOSUPPORT: number;
        UV_ENODATA: number;
        UV_EUNATCH: number;
      };
      binding(m: "http_parser"): {
        methods: [
          "DELETE",
          "GET",
          "HEAD",
          "POST",
          "PUT",
          "CONNECT",
          "OPTIONS",
          "TRACE",
          "COPY",
          "LOCK",
          "MKCOL",
          "MOVE",
          "PROPFIND",
          "PROPPATCH",
          "SEARCH",
          "UNLOCK",
          "BIND",
          "REBIND",
          "UNBIND",
          "ACL",
          "REPORT",
          "MKACTIVITY",
          "CHECKOUT",
          "MERGE",
          "M-SEARCH",
          "NOTIFY",
          "SUBSCRIBE",
          "UNSUBSCRIBE",
          "PATCH",
          "PURGE",
          "MKCALENDAR",
          "LINK",
          "UNLINK",
          "SOURCE",
          "QUERY",
        ];
        allMethods: [
          "DELETE",
          "GET",
          "HEAD",
          "POST",
          "PUT",
          "CONNECT",
          "OPTIONS",
          "TRACE",
          "COPY",
          "LOCK",
          "MKCOL",
          "MOVE",
          "PROPFIND",
          "PROPPATCH",
          "SEARCH",
          "UNLOCK",
          "BIND",
          "REBIND",
          "UNBIND",
          "ACL",
          "REPORT",
          "MKACTIVITY",
          "CHECKOUT",
          "MERGE",
          "M-SEARCH",
          "NOTIFY",
          "SUBSCRIBE",
          "UNSUBSCRIBE",
          "PATCH",
          "PURGE",
          "MKCALENDAR",
          "LINK",
          "UNLINK",
          "SOURCE",
          "PRI",
          "DESCRIBE",
          "ANNOUNCE",
          "SETUP",
          "PLAY",
          "PAUSE",
          "TEARDOWN",
          "GET_PARAMETER",
          "SET_PARAMETER",
          "REDIRECT",
          "RECORD",
          "FLUSH",
          "QUERY",
        ];
        HTTPParser: unknown;
        ConnectionsList: unknown;
      };
      binding(m: string): object;
    }

    interface ProcessVersions extends Dict<string> {
      bun: string;
    }
  }
}

declare module "node:fs/promises" {
  function exists(path: Bun.PathLike): Promise<boolean>;
}

declare module "node:tls" {
  interface BunConnectionOptions extends Omit<ConnectionOptions, "key" | "ca" | "tls" | "cert"> {
    /**
     * Override the trusted CA certificates. The default is the list of
     * well-known CAs curated by Mozilla; setting this option replaces
     * that list entirely.
     */
    ca?: string | Buffer | NodeJS.TypedArray | Bun.BunFile | Array<string | Buffer | Bun.BunFile> | undefined;
    /**
     * Cert chains in PEM format. Provide one cert chain per private key.
     * Each chain consists of the PEM certificate for its private key,
     * followed by the PEM intermediate certificates (if any) in order,
     * not including the root CA (the root CA must be pre-known to the
     * peer, see `ca`). Multiple cert chains do not have to be in the
     * same order as their private keys in `key`. Without the
     * intermediate certificates, the peer cannot validate the
     * certificate and the handshake fails.
     */
    cert?:
      | string
      | Buffer
      | NodeJS.TypedArray
      | Bun.BunFile
      | Array<string | Buffer | NodeJS.TypedArray | Bun.BunFile>
      | undefined;
    /**
     * Private keys in PEM format. PEM keys may be encrypted. Multiple
     * keys using different algorithms can be provided either as an array
     * of unencrypted key strings or buffers, or as an array of objects in
     * the form `{pem: <string|buffer>[, passphrase: <string>]}`. The
     * object form can only occur in an array, and `object.passphrase` is
     * optional. Encrypted keys are decrypted with `object.passphrase` if
     * provided, otherwise with `options.passphrase`.
     */
    key?:
      | string
      | Buffer
      | Bun.BunFile
      | NodeJS.TypedArray
      | Array<string | Buffer | Bun.BunFile | NodeJS.TypedArray | KeyObject>
      | undefined;
  }

  function connect(options: BunConnectionOptions, secureConnectListener?: () => void): TLSSocket;
}

declare module "console" {
  interface Console {
    /**
     * Asynchronously reads lines from standard input (fd 0)
     *
     * @example
     * ```ts
     * for await (const line of console) {
     *   console.log(line);
     * }
     * ```
     */
    [Symbol.asyncIterator](): AsyncIterableIterator<string>;
  }
}
