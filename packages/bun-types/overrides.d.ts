export {};

/**
 * This is like a BodyMixin, but exists to more things
 * (e.g. Blob, ReadableStream, Response, etc.)
 *
 * Notably, this doesn't have a `blob()` because it's the lowest
 * common denominator of these objects. A `Blob` in Bun does not
 * have a `.blob()` method.
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
       * Whether you are using Bun
       */
      isBun: true;

      /**
       * The current git sha of Bun
       */
      revision: string;

      reallyExit(code?: number): never;
      dlopen(module: { exports: any }, filename: string, flags?: number): void;
      _exiting: boolean;
      noDeprecation?: boolean | undefined;

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
          "M - SEARCH",
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
          "M - SEARCH",
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
     * Optionally override the trusted CA certificates. Default is to trust
     * the well-known CAs curated by Mozilla. Mozilla's CAs are completely
     * replaced when CAs are explicitly specified using this option.
     */
    ca?: string | Buffer | NodeJS.TypedArray | Bun.BunFile | Array<string | Buffer | Bun.BunFile> | undefined;
    /**
     *  Cert chains in PEM format. One cert chain should be provided per
     *  private key. Each cert chain should consist of the PEM formatted
     *  certificate for a provided private key, followed by the PEM
     *  formatted intermediate certificates (if any), in order, and not
     *  including the root CA (the root CA must be pre-known to the peer,
     *  see ca). When providing multiple cert chains, they do not have to
     *  be in the same order as their private keys in key. If the
     *  intermediate certificates are not provided, the peer will not be
     *  able to validate the certificate, and the handshake will fail.
     */
    cert?:
      | string
      | Buffer
      | NodeJS.TypedArray
      | Bun.BunFile
      | Array<string | Buffer | NodeJS.TypedArray | Bun.BunFile>
      | undefined;
    /**
     * Private keys in PEM format. PEM allows the option of private keys
     * being encrypted. Encrypted keys will be decrypted with
     * options.passphrase. Multiple keys using different algorithms can be
     * provided either as an array of unencrypted key strings or buffers,
     * or an array of objects in the form {pem: <string|buffer>[,
     * passphrase: <string>]}. The object form can only occur in an array.
     * object.passphrase is optional. Encrypted keys will be decrypted with
     * object.passphrase if provided, or options.passphrase if it is not.
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
     * Asynchronously read lines from standard input (fd 0)
     *
     * ```ts
     * for await (const line of console) {
     *   console.log(line);
     * }
     * ```
     */
    [Symbol.asyncIterator](): AsyncIterableIterator<string>;
  }
}

interface Map<K, V> {
  /**
   * Gets the value for a key, or inserts a default value if the key does not exist.
   * @param key - The key to look up
   * @param value - The value to insert if the key does not exist
   * @returns The existing value for the key, or the newly inserted value
   */
  getOrInsert(key: K, value: V): V;

  /**
   * Gets the value for a key, or computes and inserts a default value if the key does not exist.
   * @param key - The key to look up
   * @param fn - A function that computes the default value
   * @returns The existing value for the key, or the newly computed and inserted value
   */
  getOrInsertComputed(key: K, fn: () => V): V;
}

// Add missing performance.timerify type
declare module "node:perf_hooks" {
  interface Performance {
    /**
     * Wraps a function to measure its execution time.
     * @param fn - The function to wrap
     * @returns A wrapped version of the function that measures execution time
     */
    timerify<T extends (...args: any[]) => any>(fn: T): T;
  }
}

// Add missing type for process.initgroups
declare module "node:process" {
  interface Process {
    /**
     * Initializes the group access list.
     * @param user - The user name or numeric ID
     * @param extraGroup - A group name or ID
     */
    initgroups(user: string | number, extraGroup: string | number): void;
    
    /**
     * Returns the CPU time used by the current thread.
     * @param user - If true, returns user time; if false, returns system time
     * @returns An object with user and system CPU time in microseconds
     */
    threadCpuUsage(user?: boolean): { user: number; system: number };
  }
}

</tool_call><tool_call>exec<arg_key>command</arg_key><arg_value>cd /root/.openclaw/workspace/bun-fork && cat >> packages/bun-types/overrides.d.ts << 'EOF'

//</tool_call>

// Add module.findPackageJSON type
declare module "node:module" {
  interface Module {
    /**
     * Finds the package.json file for a given module.
     * @param request - The module request path
     * @returns The package.json path or null if not found
     */
    findPackageJSON(request: string): string | null;
  }
}

// Add console.assert proper type with message
declare module "console" {
  interface Console {
    /**
     * Asserts that an expression is true. If not, prints an error message.
     * @param value - The value to assert
     * @param message - Optional message to display if assertion fails
     */
    assert(value: unknown, message?: string | Error): void;
  }
}

// Add describe() with function support for bun:test
declare module "bun:test" {
  interface Test {
    /**
     * Define a test suite using the function name.
     * @param fn - The test function (name is used as test name)
     * @param fn - Optional test callback
     */
    describe(name: string, fn?: (this: Test) => void): void;
    describe(fn: (this: Test) => void, callback?: (this: Test) => void): void;
  }
}

// Add shell completion types
declare namespace Bun {
  interface ShellCompletionResolver {
    /**
     * Provides shell completions for a command.
     * @param args - Command arguments
     * @param context - Completion context
     * @returns Array of completion options
     */
    (args: string[], context: { cwd: string }): string[];
  }
}

// Add Date header to Response type
declare global {
  interface Response {
    /**
     * Gets the Date header value.
     * Returns the date string or null if not set.
     */
    get date(): string | null;
  }
}

<tool_call>exec<arg_key>command</arg_key><arg_value>cd /root/.openclaw/workspace/bun-fork && cat >> packages/bun-types/overrides.d.ts << 'EOF'

//</tool_call>

// Add tracingChannel types
declare module "node:diagnostics_channel" {
  interface TracingChannel {
    /**
     * Check if the channel has any subscribers.
     */
    hasSubscribers: boolean;
  }
}

// Add undici.Agent.close() method
declare module "undici" {
  interface Agent {
    /**
     * Asynchronously closes the agent and all associated connections.
     */
    close(): Promise<void>;
  }
}

//

// Add FetchResult type improvements
declare namespace Bun {
  interface FetchResult {
    /**
     * The response object.
     */
    response: Response;
    
    /**
     * Whether the response was served from cache.
     */
    fromCache?: boolean;
    
    /**
     * The time it took to fetch the resource in milliseconds.
     */
    timing?: number;
  }
}

// Add S3 checksumAlgorithm fix
declare namespace Bun {
  interface S3ListObjectsResponse {
    contents: Array<{
      key: string;
      size: number;
      /**
       * Checksum algorithm used (note: property name was 'checksumAlgorithmE' in some versions)
       */
      checksumAlgorithm?: string;
    }>;
  }
}

// Add Database constructor options
declare namespace Bun {
  interface DatabaseOptions {
    /**
     * Whether to create parent directories if they don't exist.
     * @default true
     */
    createPath?: boolean;
    
    /**
     * Whether to open the database in read-only mode.
     * @default false
     */
    readonly?: boolean;
    
    /**
     * File mode permissions (Unix-style octal).
     */
    mode?: number;
  }
}

<tool_call>exec<arg_key>command</arg_key><arg_value>cd /root/.openclaw/workspace/bun-fork && cat >> packages/bun-types/overrides.d.ts << 'EOF'

//</tool_call>

// Add Test.todo function signature
declare module "bun:test" {
  interface Test {
    /**
     * Marks a test as a TODO (skipped test).
     * @param name - The test name
     * @param fn - Optional test function (should be empty or contain todo.skip())
     */
    todo(name: string, fn?: (this: Test) => void): void;
  }
}

//</tool_call>

// Add crypto hash algorithm aliases
declare module "node:crypto" {
  interface Hash {
    /**
     * Updates the hash with the shake-128 algorithm.
     */
    shake128(): Hash;
    
    /**
     * Updates the hash with the shake-256 algorithm.
     */
    shake256(): Hash;
  }
}

// Add File and PathLike union types
declare namespace Bun {
  type PathLike = string | Buffer | URL;
  
  interface FileLike {
    /**
     * Reads file content as text.
     */
    text(): Promise<string>;
    
    /**
     * Reads file content as ArrayBuffer.
     */
    arrayBuffer(): Promise<ArrayBuffer>;
    
    /**
     * Gets file size in bytes.
     */
    size: number;
    
    /**
     * Gets last modified time.
     */
    lastModified: number;
  }
}

// Add Shell configuration types
declare namespace Bun {
  interface ShellOptions {
    /**
     * Working directory for shell commands.
     */
    cwd?: string;
    
    /**
     * Environment variables.
     */
    env?: Record<string, string>;
    
    /**
     * Whether to use quiet mode (no output).
     */
    quiet?: boolean;
  }
  
  interface ShellResult {
    /**
     * Exit code of the shell command.
     */
    exitCode: number;
    
    /**
     * Standard output text.
     */
    stdout: string;
    
    /**
     * Standard error text.
     */
    stderr: string;
    
    /**
     * Whether the command succeeded.
     */
    success: boolean;
  }
}

// Add TOML configuration types
declare namespace Bun {
  interface TOML {
    /**
     * Loads a TOML file and returns the parsed object.
     * @param path - Path to the TOML file
     */
    load(path: string | PathLike): Promise<Record<string, any>>;
    
    /**
     * Synchronously loads a TOML file.
     * @param path - Path to the TOML file
     */
    loadSync(path: string | PathLike): Record<string, any>;
  }
}

// Add Server configuration types
declare namespace Bun {
  interface ServerOptions<T extends typeof Bun.file = typeof Bun.file> {
    /**
     * Fetch handler for incoming requests.
     */
    fetch: (req: Request) => Response | Promise<Response>;
    
    /**
     * Base URL for the server.
     */
    baseURL?: string;
    
    /**
     * Whether to use TLS/SSL.
     */
    tls?: {
      key: string | Buffer;
      cert: string | Buffer;
    };
    
    /**
     * WebSocket handler.
     */
    websocket?: {
      message: (ws: ServerWebSocket, message: string | Buffer) => void;
      open: (ws: ServerWebSocket) => void;
      close: (ws: ServerWebSocket, code: number, reason: string) => void;
    };
    
    /**
     * Static file serving configuration.
     */
    static?: {
      dir: string;
      prefix?: string;
    };
    
    /**
     * Port number to listen on.
     */
    port?: number;
    
    /**
     * Hostname to bind to.
     */
    hostname?: string;
  }
  
  interface ServerWebSocket {
    /**
     * Sends data to the WebSocket client.
     */
    send(data: string | Buffer): void;
    
    /**
     * Closes the WebSocket connection.
     */
    close(code?: number, reason?: string): void;
    
    /**
     * Subscribe to a topic.
     */
    subscribe(topic: string): void;
    
    /**
     * Publish to a topic.
     */
    publish(topic: string, data: string | Buffer): void;
  }
}

// Add Build and bundler types
declare namespace Bun {
  interface BuildOptions {
    /**
     * Entry point(s) for the build.
     */
    entrypoints: string | string[] | Record<string, string>;
    
    /**
     * Output directory.
     */
    outdir?: string;
    
    /**
     * Target name.
     */
    name?: string;
    
    /**
     * Bundle format: 'esm' | 'cjs' | 'iife'
     */
    format?: 'esm' | 'cjs' | 'iife';
    
    /**
     * Target platform: 'browser' | 'node' | 'bun'
     */
    target?: 'browser' | 'node' | 'bun';
    
    /**
     * Whether to minify output.
     */
    minify?: boolean;
    
    /**
     * Whether to generate source maps.
     */
    sourcemap?: boolean | 'inline' | 'external';
    
    /**
     * External modules to exclude from bundle.
     */
    external?: string[];
    
    /**
     * Plugins to use during build.
     */
    plugins?: any[];
  }
  
  interface BuildOutput {
    /**
     * Path to the output file.
     */
    path: string;
    
    /**
     * Output file contents.
     */
    outputs: Record<string, { size: number; hash: string }>;
    
    /**
     * Build metadata.
     */
    meta: Record<string, any>;
  }
}

// Add Promise utility types
declare global {
  interface PromiseConstructor {
    /**
     * Creates a promise that rejects with a reason.
     * @param reason - The rejection reason
     */
    reject<T = never>(reason?: any): Promise<T>;
    
    /**
     * Creates a promise that resolves with a value.
     * @param value - The resolution value
     */
    resolve<T>(value: T | PromiseLike<T>): Promise<T>;
    
    /**
     * Creates a promise that resolves after a delay.
     * @param ms - Milliseconds to delay
     */
    delay(ms: number): Promise<void>;
  }
}

// Add File system utility types
declare namespace Bun {
  interface FileBlob {
    /**
     * Reads file as text.
     */
    text(): Promise<string>;
    
    /**
     * Reads file as ArrayBuffer.
     */
    arrayBuffer(): Promise<ArrayBuffer>;
    
    /**
     * Gets file size.
     */
    size: number;
    
    /**
     * Gets file type (MIME).
     */
    type: string;
    
    /**
     * Gets last modified time.
     */
    lastModified: number;
    
    /**
     * Writes data to file.
     */
    write(data: string | Buffer | Blob): Promise<number>;
  }
  
  interface FileSink {
    /**
     * Writes data to the sink.
     */
    write(data: string | Buffer | Uint8Array): Promise<number>;
    
    /**
     * Flushes buffered data.
     */
    flush(): Promise<void>;
    
    /**
     * Closes the sink.
     */
    close(): Promise<void>;
  }
}

// Add Test runner types
declare namespace Bun {
  interface TestOptions {
    /**
     * Test timeout in milliseconds.
     */
    timeout?: number;
    
    /**
     * Whether to skip this test.
     */
    skip?: boolean;
    
    /**
     * Whether this test is expected to fail.
     */
    todo?: boolean;
    
    /**
     * Number of times to retry the test on failure.
     */
    retry?: number;
    
    /**
     * Test-only flag.
     */
    only?: boolean;
  }
  
  interface TestContext {
    /**
     * Skips the current test.
     */
    skip(): void;
    
    /**
     * Marks test as todo.
     */
    todo(): void;
    
    /**
     * Gets test metadata.
     */
    readonly name: string;
  }
}

// Add Environment variable types
declare namespace Bun {
  interface Env {
    /**
     * NODE_ENV environment variable.
     */
    NODE_ENV?: 'development' | 'production' | 'test';
    
    /**
     * BUN_DEBUG environment variable.
     */
    BUN_DEBUG?: '1' | '0' | 'true' | 'false';
    
    /**
     * BUN_CONFIG_ prefixed environment variables.
     */
    [key: `BUN_CONFIG_${string}`]: string | undefined;
  }
  
  /**
   * Process.env with Bun-specific variables.
   */
  interface ProcessEnv extends NodeJS.ProcessEnv {
    NODE_ENV?: 'development' | 'production' | 'test';
    BUN_DEBUG?: '1' | '0' | 'true' | 'false';
  }
}

// Add REPL types
declare namespace Bun {
  interface REPLServer {
    /**
     * Starts the REPL server.
     */
    start(): void;
    
    /**
     * Evaluates code in the REPL context.
     */
    eval(code: string): any;
    
    /**
     * Completes input for tab completion.
     */
    complete(input: string): string[];
  }
  
  interface REPOptions {
    /**
     * Whether to use the global context.
     */
    useGlobal?: boolean;
    
    /**
     * Whether to ignore undefined results.
     */
    ignoreUndefined?: boolean;
  }
}
