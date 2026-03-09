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

// Add Worker types
declare namespace Bun {
  interface WorkerOptions {
    /**
     * Worker type: 'js' | 'ts'
     */
    type?: 'js' | 'ts';
    
    /**
     * Whether to use bun runtime.
     */
    bun?: boolean;
    
    /**
     * Worker name for debugging.
     */
    name?: string;
    
    /**
     * Whether to share the environment.
     */
    env?: Record<string, string>;
  }
  
  interface Worker {
    /**
     * Sends a message to the worker.
     */
    postMessage(data: any): void;
    
    /**
     * Terminates the worker.
     */
    terminate(): void;
    
    /**
     * Event fired when worker sends a message.
     */
    onmessage: (event: { data: any }) => void;
    
    /**
     * Event fired on error.
     */
    onerror: (error: Error) => void;
  }
}

// Add crypto types
declare namespace Bun {
  interface CryptoHash {
    /**
     * Updates hash with data.
     */
    update(data: string | Buffer | ArrayBuffer): CryptoHash;
    
    /**
     * Returns digest as hex string.
     */
    digest(type: 'hex'): string;
    
    /**
     * Returns digest as base64.
     */
    digest(type: 'base64'): string;
    
    /**
     * Returns digest as Buffer.
     */
    digest(type: 'buffer'): Buffer;
  }
  
  interface Crypto {
    /**
     * Creates a hash instance.
     */
    createHash(algorithm: string): CryptoHash;
    
    /**
     * One-shot hash function.
     */
    hash(algorithm: string, data: string | Buffer | ArrayBuffer, outputType?: 'hex' | 'base64' | 'buffer'): string | Buffer;
  }
}

// Add HTTP server types
declare namespace Bun {
  interface IncomingMessage {
    /**
     * HTTP method.
     */
    method: string;
    
    /**
     * Request URL.
     */
    url: string;
    
    /**
     * Request headers.
     */
    headers: Headers;
    
    /**
     * Request body as text.
     */
    text(): Promise<string>;
    
    /**
     * Request body as JSON.
     */
    json(): Promise<any>;
    
    /**
     * Request body as ArrayBuffer.
     */
    arrayBuffer(): Promise<ArrayBuffer>;
  }
  
  interface ServerResponse {
    /**
     * HTTP status code.
     */
    status: number;
    
    /**
     * Response headers.
     */
    headers: Headers;
    
    /**
     * Sets response status code.
     */
    setStatus(code: number): void;
    
    /**
     * Sends response body.
     */
    send(body: string | Buffer | ReadableStream): void;
    
    /**
     * Ends response.
     */
    end(): void;
  }
}

// Add Stream types
declare namespace Bun {
  interface ReadableStream {
    /**
     * Reads from stream.
     */
    read(): Promise<IteratorResult<any>>;
    
    /**
     * Pipes stream to destination.
     */
    pipe(destination: WritableStream): void;
    
    /**
     * Cancels the stream.
     */
    cancel(): Promise<void>;
    
    /**
     * Locks the stream.
     */
    lock(): void;
    
    /**
     * Unlocks the stream.
     */
    unlock(): void;
  }
  
  interface WritableStream {
    /**
     * Writes to stream.
     */
    write(chunk: any): Promise<void>;
    
    /**
     * Closes the stream.
     */
    close(): Promise<void>;
    
    /**
     * Aborts the stream.
     */
    abort(reason?: any): Promise<void>;
  }
  
  interface TransformStream extends ReadableStream, WritableStream {}
}

// Add Socket types
declare namespace Bun {
  interface Socket {
    /**
     * Socket address.
     */
    readonly address: {
      address: string;
      family: 'IPv4' | 'IPv6';
      port: number;
    };
    
    /**
     * Remote address.
     */
    readonly remoteAddress: {
      address: string;
      family: 'IPv4' | 'IPv6';
      port: number;
    };
    
    /**
     * Is socket ready?
     */
    readonly readyState: 'opening' | 'open' | 'closing' | 'closed';
    
    /**
     * Sends data.
     */
    send(data: string | Buffer | Uint8Array): void;
    
    /**
     * Closes socket.
     */
    close(): void;
    
    /**
     * Event: data received.
     */
    ondata: (data: Buffer) => void;
    
    /**
     * Event: socket closed.
     */
    onclose: () => void;
    
    /**
     * Event: error occurred.
     */
    onerror: (error: Error) => void;
  }
}

// Add FileSystem types
declare namespace Bun {
  interface FileStat {
    /**
     * Is directory?
     */
    isDirectory(): boolean;
    
    /**
     * Is file?
     */
    isFile(): boolean;
    
    /**
     * Is symbolic link?
     */
    isSymbolicLink(): boolean;
    
    /**
     * File size in bytes.
     */
    size: number;
    
    /**
     * Last modified time.
     */
    mtimeMs: number;
    
    /**
     * Creation time.
     */
    birthtimeMs: number;
    
    /**
     * File mode (Unix).
     */
    mode: number;
  }
  
  interface FileSystem {
    /**
     * Reads file content.
     */
    readFile(path: string | PathLike): Promise<Buffer>;
    
    /**
     * Writes file content.
     */
    writeFile(path: string | PathLike, data: string | Buffer): Promise<void>;
    
    /**
     * Checks if file exists.
     */
    exists(path: string | PathLike): Promise<boolean>;
    
    /**
     * Gets file stats.
     */
    stat(path: string | PathLike): Promise<FileStat>;
  }
}

// Add Plugin types
declare namespace Bun {
  interface Plugin {
    /**
     * Plugin name.
     */
    name: string;
    
    /**
     * Setup function called when plugin loads.
     */
    setup(build: any): void | Promise<void>;
    
    /**
     * Teardown function called when plugin unloads.
     */
    teardown?(): void | Promise<void>;
    
    /**
     * onLoad callback for module loading.
     */
    onLoad?(args: { path: string }): any;
    
    /**
     * onEnd callback after build completes.
     */
    onEnd?(result: any): void | Promise<void>;
  }
  
  interface PluginBuilder {
    /**
     * Adds a plugin to the build.
     */
    plugin(plugin: Plugin): this;
    
    /**
     * Configures the build.
     */
    config(options: any): this;
  }
}

// Add CLI types
declare namespace Bun {
  interface CLIOption {
    /**
     * Option name.
     */
    name: string;
    
    /**
     * Option type.
     */
    type: 'string' | 'number' | 'boolean';
    
    /**
     * Short flag.
     */
    short?: string;
    
    /**
     * Option description.
     */
    description?: string;
    
    /**
     * Default value.
     */
    default?: any;
    
    /**
     * Is required?
     */
    required?: boolean;
  }
  
  interface CLI {
    /**
     * Runs a CLI command.
     */
    run(command: string, args?: string[]): Promise<number>;
    
    /**
     * Runs a command synchronously.
     */
    runSync(command: string, args?: string[]): number;
  }
}

// Add Network types
declare namespace Bun {
  interface IPAddress {
    /**
     * IP address string.
     */
    address: string;
    
    /**
     * IP version.
     */
    version: 'IPv4' | 'IPv6';
    
    /**
     * Port number.
     */
    port?: number;
  }
  
  interface NetworkInterface {
    /**
     * Interface name.
     */
    name: string;
    
    /**
     * Interface addresses.
     */
    addresses: IPAddress[];
    
    /**
     * Is interface up?
     */
    up: boolean;
    
    /**
     * MAC address.
     */
    mac?: string;
  }
  
  interface Network {
    /**
     * Gets network interfaces.
     */
    interfaces(): Record<string, NetworkInterface>;
  }
}

// Add Logger types
declare namespace Bun {
  interface Logger {
    /**
     * Logs debug message.
     */
    debug(message: string, ...args: any[]): void;
    
    /**
     * Logs info message.
     */
    info(message: string, ...args: any[]): void;
    
    /**
     * Logs warning message.
     */
    warn(message: string, ...args: any[]): void;
    
    /**
     * Logs error message.
     */
    error(message: string, ...args: any[]): void;
    
    /**
     * Logs trace message.
     */
    trace(message: string, ...args: any[]): void;
    
    /**
     * Sets log level.
     */
    setLevel(level: 'debug' | 'info' | 'warn' | 'error'): void;
  }
  
  interface LoggerOptions {
    /**
     * Log level.
     */
    level?: 'debug' | 'info' | 'warn' | 'error';
    
    /**
     * Include timestamp?
     */
    timestamp?: boolean;
    
    /**
     * Colorize output?
     */
    colorize?: boolean;
  }
}

// Add Event Emitter types
declare namespace Bun {
  interface EventEmitter {
    /**
     * Adds event listener.
     */
    on(event: string, listener: (...args: any[]) => void): this;
    
    /**
     * Adds one-time event listener.
     */
    once(event: string, listener: (...args: any[]) => void): this;
    
    /**
     * Removes event listener.
     */
    off(event: string, listener: (...args: any[]) => void): this;
    
    /**
     * Emits event.
     */
    emit(event: string, ...args: any[]): boolean;
    
    /**
     * Removes all listeners.
     */
    removeAllListeners(event?: string): this;
    
    /**
     * Gets listener count.
     */
    listenerCount(event: string): number;
  }
}

// Add Timer types
declare namespace Bun {
  interface Timer {
    /**
     * Clears the timer.
     */
    clear(): void;
    
    /**
     * Refreshes the timer.
     */
    refresh(): void;
    
    /**
     * Gets remaining time.
     */
    remaining(): number;
  }
  
  interface TimerOptions {
    /**
     * Delay in milliseconds.
     */
    delay: number;
    
    /**
     * Should timer repeat?
     */
    repeat?: boolean;
    
    /**
     * Timer callback.
     */
    callback: () => void;
  }
}

// Add Cache types
declare namespace Bun {
  interface CacheEntry {
    /**
     * Cache key.
     */
    key: string;
    
    /**
     * Cache value.
     */
    value: any;
    
    /**
     * Entry TTL in milliseconds.
     */
    ttl?: number;
    
    /**
     * Entry creation time.
     */
    created: number;
    
    /**
     * Last access time.
     */
    accessed: number;
  }
  
  interface Cache {
    /**
     * Gets value from cache.
     */
    get(key: string): Promise<any>;
    
    /**
     * Sets value in cache.
     */
    set(key: string, value: any, ttl?: number): Promise<void>;
    
    /**
     * Deletes value from cache.
     */
    delete(key: string): Promise<boolean>;
    
    /**
     * Clears all cache.
     */
    clear(): Promise<void>;
    
    /**
     * Checks if key exists.
     */
    has(key: string): Promise<boolean>;
  }
}

// Add Queue types
declare namespace Bun {
  interface Queue {
    /**
     * Adds item to queue.
     */
    enqueue(item: any): void;
    
    /**
     * Removes and returns item from queue.
     */
    dequeue(): any;
    
    /**
     * Peeks at front item.
     */
    peek(): any;
    
    /**
     * Gets queue size.
     */
    size: number;
    
    /**
     * Checks if queue is empty.
     */
    isEmpty(): boolean;
    
    /**
     * Clears queue.
     */
    clear(): void;
  }
  
  interface PriorityQueue extends Queue {
    /**
     * Adds item with priority.
     */
    enqueue(item: any, priority: number): void;
  }
}

// Add Buffer utilities
declare namespace Bun {
  interface Buffer extends Uint8Array {
    /**
     * Converts buffer to hex string.
     */
    toString(encoding: 'hex'): string;
    
    /**
     * Converts buffer to base64.
     */
    toString(encoding: 'base64'): string;
    
    /**
     * Converts buffer to UTF-8 string.
     */
    toString(encoding: 'utf-8'): string;
    
    /**
     * Creates buffer from string.
     */
    from(str: string, encoding?: 'utf-8' | 'hex' | 'base64'): Buffer;
    
    /**
     * Concatenates buffers.
     */
    concat(...buffers: Buffer[]): Buffer;
  }
}

// Add MIME type utilities
declare namespace Bun {
  interface MIMEType {
    /**
     * MIME type string.
     */
    type: string;
    
    /**
     * MIME subtype.
     */
    subtype: string;
    
    /**
     * MIME parameters.
     */
    parameters: Record<string, string>;
    
    /**
     * Full MIME string.
     */
    toString(): string;
  }
  
  interface MIME {
    /**
     * Gets MIME type for extension.
     */
    getType(extension: string): string | null;
    
    /**
     * Gets extension for MIME type.
     */
    getExtension(mimeType: string): string | null;
  }
}

// Add Path utilities
declare namespace Bun {
  interface Path {
    /**
     * Joins path segments.
     */
    join(...paths: string[]): string;
    
    /**
     * Normalizes path.
     */
    normalize(path: string): string;
    
    /**
     * Gets directory name.
     */
    dirname(path: string): string;
    
    /**
     * Gets base name.
     */
    basename(path: string, ext?: string): string;
    
    /**
     * Gets file extension.
     */
    extname(path: string): string;
    
    /**
     * Checks if path is absolute.
     */
    isAbsolute(path: string): boolean;
    
    /**
     * Resolves path to absolute.
     */
    resolve(...paths: string[]): string;
  }
}

// Add URL utilities
declare namespace Bun {
  interface URLSearchParams {
    /**
     * Gets parameter value.
     */
    get(name: string): string | null;
    
    /**
     * Sets parameter value.
     */
    set(name: string, value: string): void;
    
    /**
     * Deletes parameter.
     */
    delete(name: string): void;
    
    /**
     * Checks if parameter exists.
     */
    has(name: string): boolean;
    
    /**
     * Appends parameter.
     */
    append(name: string, value: string): void;
    
    /**
     * Converts to object.
     */
    toObject(): Record<string, string>;
  }
}

// Add Inspector/Debugger types
declare namespace Bun {
  interface Inspector {
    /**
     * Opens inspector.
     */
    open(port?: number): void;
    
    /**
     * Closes inspector.
     */
    close(): void;
    
    /**
     * Gets inspector URL.
     */
    url(): string;
  }
  
  interface Breakpoint {
    /**
     * Breakpoint location.
     */
    line: number;
    column?: number;
    
    /**
     * Breakpoint condition.
     */
    condition?: string;
    
    /**
     * Is breakpoint enabled?
     */
    enabled: boolean;
  }
}

// Add Profiler types
declare namespace Bun {
  interface Profiler {
    /**
     * Starts profiling.
     */
    start(): void;
    
    /**
     * Stops profiling.
     */
    stop(): void;
    
    /**
     * Gets profile data.
     */
    getProfile(): any;
    
    /**
     * Clears profile data.
     */
    clear(): void;
  }
  
  interface ProfileNode {
    /**
     * Function name.
     */
    name: string;
    
    /**
     * Script URL.
     */
    url: string;
    
    /**
     * Line number.
     */
    line: number;
    
    /**
     * Column number.
     */
    column: number;
    
    /**
     * Execution time.
     */
    duration: number;
    
    /**
     * Child nodes.
     */
    children: ProfileNode[];
  }
}

// Add Metrics types
declare namespace Bun {
  interface Metrics {
    /**
     * CPU usage percentage.
     */
    cpuUsage: number;
    
    /**
     * Memory usage in bytes.
     */
    memoryUsage: number;
    
    /**
     * Event loop delay in milliseconds.
     */
    eventLoopDelay: number;
    
    /**
     * Active handles count.
     */
    activeHandles: number;
    
    /**
     * Active requests count.
     */
    activeRequests: number;
    
    /**
     * Gets current metrics.
     */
    getMetrics(): Metrics;
  }
  
  interface MetricCounter {
    /**
     * Increments counter.
     */
    increment(value?: number): void;
    
    /**
     * Decrements counter.
     */
    decrement(value?: number): void;
    
    /**
     * Resets counter.
     */
    reset(): void;
    
    /**
     * Gets counter value.
     */
    getValue(): number;
  }
}

// Add Configuration types
declare namespace Bun {
  interface Config {
    /**
     * Log level.
     */
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
    
    /**
     * TZ (timezone).
     */
    tz?: string;
    
    /**
     * Locale.
     */
    locale?: string;
    
    /**
     * Max threads.
     */
    maxThreads?: number;
    
    /**
     * GC threshold.
     */
    gcThreshold?: number;
  }
  
  interface EnvironmentConfig {
    /**
     * Development mode?
     */
    development?: boolean;
    
    /**
     * Test mode?
     */
    test?: boolean;
    
    /**
     * Production mode?
     */
    production?: boolean;
  }
}

// Add Clipboard types
declare namespace Bun {
  interface Clipboard {
    /**
     * Reads text from clipboard.
     */
    readText(): Promise<string>;
    
    /**
     * Writes text to clipboard.
     */
    writeText(text: string): Promise<void>;
    
    /**
     * Reads data from clipboard.
     */
    read(format?: 'text' | 'image' | 'html'): Promise<string | Buffer>;
    
    /**
     * Writes data to clipboard.
     */
    write(data: string | Buffer, format?: 'text' | 'image' | 'html'): Promise<void>;
    
    /**
     * Clears clipboard.
     */
    clear(): Promise<void>;
  }
}

// Add Notification types
declare namespace Bun {
  interface Notification {
    /**
     * Notification title.
     */
    title: string;
    
    /**
     * Notification body.
     */
    body?: string;
    
    /**
     * Notification icon.
     */
    icon?: string;
    
    /**
     * Shows notification.
     */
    show(): void;
    
    /**
     * Closes notification.
     */
    close(): void;
    
    /**
     * Event: on click.
     */
    onclick?: () => void;
    
    /**
     * Event: on close.
     */
    onclose?: () => void;
  }
}

// Add Compression types
declare namespace Bun {
  interface CompressionStream {
    /**
     * Creates compression stream.
     */
    create(format?: 'gzip' | 'deflate' | 'brotli'): ReadableStream;
    
    /**
     * Compresses data.
     */
    compress(data: Buffer | ArrayBuffer): Buffer;
  }
  
  interface DecompressionStream {
    /**
     * Creates decompression stream.
     */
    create(format?: 'gzip' | 'deflate' | 'brotli'): ReadableStream;
    
    /**
     * Decompresses data.
     */
    decompress(data: Buffer | ArrayBuffer): Buffer;
  }
}

// Add Hash types
declare namespace Bun {
  interface Hash {
    /**
     * Updates hash with data.
     */
    update(data: string | Buffer | ArrayBuffer): Hash;
    
    /**
     * Returns digest as specified format.
     */
    digest(encoding?: 'hex' | 'base64' | 'buffer'): string | Buffer;
    
    /**
     * Copies hash instance.
     */
    copy(): Hash;
  }
  
  interface Hasher {
    /**
     * Creates hash instance.
     */
    create(algorithm: 'md5' | 'sha1' | 'sha256' | 'sha512' | 'shake128' | 'shake256'): Hash;
    
    /**
     * One-shot hash function.
     */
    hash(algorithm: string, data: string | Buffer | ArrayBuffer, encoding?: 'hex' | 'base64' | 'buffer'): string | Buffer;
  }
}

// Add HMAC types
declare namespace Bun {
  interface HMAC {
    /**
     * Updates HMAC with data.
     */
    update(data: string | Buffer | ArrayBuffer): HMAC;
    
    /**
     * Returns digest as specified format.
     */
    digest(encoding?: 'hex' | 'base64' | 'buffer'): string | Buffer;
  }
  
  interface HMACer {
    /**
     * Creates HMAC instance.
     */
    create(algorithm: string, key: string | Buffer): HMAC;
    
    /**
     * One-shot HMAC function.
     */
    hmac(algorithm: string, key: string | Buffer, data: string | Buffer | ArrayBuffer, encoding?: 'hex' | 'base64' | 'buffer'): string | Buffer;
  }
}

// Add Cipher types
declare namespace Bun {
  interface Cipher {
    /**
     * Encrypts data.
     */
    encrypt(data: Buffer | ArrayBuffer | string): Buffer;
    
    /**
     * Finalizes encryption.
     */
    final(): Buffer;
    
    /**
     * Sets authentication tag.
     */
    setAuthTag(tag: Buffer): void;
  }
  
  interface Decipher {
    /**
     * Decrypts data.
     */
    decrypt(data: Buffer | ArrayBuffer | string): Buffer;
    
    /**
     * Finalizes decryption.
     */
    final(): Buffer;
    
    /**
     * Gets authentication tag.
     */
    getAuthTag(): Buffer;
  }
}

// Add Random number generator types
declare namespace Bun {
  interface Random {
    /**
     * Generates random bytes.
     */
    bytes(length: number): Buffer;
    
    /**
     * Generates random number.
     */
    number(max?: number): number;
    
    /**
     * Generates random UUID.
     */
    uuid(): string;
    
    /**
     * Generates random boolean.
     */
    boolean(): boolean;
  }
}

// Add Text encoder/decoder types
declare namespace Bun {
  interface TextEncoder {
    /**
     * Encodes string to UTF-8 bytes.
     */
    encode(input?: string): Uint8Array;
    
    /**
     * Encoding name.
     */
    readonly encoding: 'utf-8';
  }
  
  interface TextDecoder {
    /**
     * Decodes bytes to string.
     */
    decode(input?: BufferSource | ArrayBuffer, options?: { stream?: boolean }): string;
    
    /**
     * Encoding name.
     */
    readonly encoding: string;
    
    /**
     * Fatal flag.
     */
    readonly fatal: boolean;
    
    /**
     * Ignore BOM flag.
     */
    readonly ignoreBOM: boolean;
  }
}

// Add Atomics types
declare namespace Bun {
  interface Atomics {
    /**
     * Adds value to array element.
     */
    add(typedArray: ArrayBufferView, index: number, value: number): number;
    
    /**
     * Subtracts value from array element.
     */
    sub(typedArray: ArrayBufferView, index: number, value: number): number;
    
    /**
     * Performs bitwise AND.
     */
    and(typedArray: ArrayBufferView, index: number, value: number): number;
    
    /**
     * Performs bitwise OR.
     */
    or(typedArray: ArrayBufferView, index: number, value: number): number;
    
    /**
     * Performs bitwise XOR.
     */
    xor(typedArray: ArrayBufferView, index: number, value: number): number;
    
    /**
     * Compares and exchanges value.
     */
    compareExchange(typedArray: ArrayBufferView, index: number, expectedValue: number, replacementValue: number): number;
    
    /**
     * Exchanges value.
     */
    exchange(typedArray: ArrayBufferView, index: number, value: number): number;
    
    /**
     * Waits for value to change.
     */
    wait(typedArray: ArrayBufferView, index: number, value: number, timeout?: number): 'ok' | 'not-equal' | 'timed-out';
    
    /**
     * Wakes up waiting agent.
     */
    notify(typedArray: ArrayBufferView, index: number, count?: number): number;
  }
}

// Add SharedArrayBuffer types
declare namespace Bun {
  interface SharedArrayBuffer {
    /**
     * Buffer length in bytes.
     */
    readonly byteLength: number;
    
    /**
     * Shared memory reference.
     */
    readonly shared: true;
    
    /**
     * Slices the buffer.
     */
    slice(begin?: number, end?: number): SharedArrayBuffer;
  }
  
  interface SharedArrayBufferConstructor {
    /**
     * Creates shared buffer.
     */
    new(byteLength: number): SharedArrayBuffer;
  }
}

// Add WeakRef and FinalizationRegistry types
declare namespace Bun {
  interface WeakRef<T extends object> {
    /**
     * Gets referenced object or undefined if garbage collected.
     */
    deref(): T | undefined;
  }
  
  interface FinalizationRegistry {
    /**
     * Registers target for cleanup callback.
     */
    register(target: object, heldValue: any, unregisterToken?: object): void;
    
    /**
     * Unregisters target.
     */
    unregister(unregisterToken: object): boolean;
  }
}

// Add BigInt utilities
declare namespace Bun {
  interface BigIntConstructor {
    /**
     * Parses bigint from string.
     */
    parseFloat(str: string): bigint;
    
    /**
     * Converts bigint to string.
     */
    toString(bigint: bigint, radix?: number): string;
    
    /**
     * Creates bigint from random bytes.
     */
    randomBytes(length: number): bigint;
  }
  
  interface BigInt {
    /**
     * Converts to number.
     */
    toNumber(): number;
    
    /**
     * Converts to string.
     */
    toString(radix?: number): string;
    
    /**
     * Gets bigint value.
     */
    valueOf(): bigint;
  }
}

// Add Temporal (Date) types
declare namespace Bun {
  interface Temporal {
    /**
     * Gets current instant.
     */
    now(): Temporal.Instant;
    
    /**
     * Creates plain date.
     */
    createDate(year: number, month: number, day: number): Temporal.PlainDate;
    
    /**
     * Creates plain time.
     */
    createTime(hour: number, minute: number, second?: number, millisecond?: number, microsecond?: number, nanosecond?: number): Temporal.PlainTime;
    
    /**
     * Creates plain datetime.
     */
    createDateTime(year: number, month: number, day: number, hour: number, minute: number, second?: number): Temporal.PlainDateTime;
    
    /**
     * Creates zoned datetime.
     */
    createZonedDateTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Temporal.ZonedDateTime;
  }
}

// Add Reflect types
declare namespace Bun {
  interface Reflect {
    /**
     * Gets property descriptor.
     */
    getDescriptor(target: object, key: string | symbol): PropertyDescriptor | undefined;
    
    /**
     * Gets property descriptors.
     */
    getDescriptors(target: object): Record<string, PropertyDescriptor>;
    
    /**
     * Gets prototype.
     */
    getPrototypeOf(target: object): object | null;
    
    /**
     * Sets prototype.
     */
    setPrototypeOf(target: object, prototype: object | null): boolean;
    
    /**
     * Deletes property.
     */
    deleteProperty(target: object, key: string | symbol): boolean;
    
    /**
     * Applies function.
     */
    apply(target: Function, thisArgument: any, argumentsList: any[]): any;
    
    /**
     * Constructs object.
     */
    construct(target: Function, argumentsList: any[], newTarget?: Function): object;
  }
}

// Add Proxy types
declare namespace Bun {
  interface ProxyHandler<T extends object> {
    /**
     * Gets trap.
     */
    get?(target: T, key: string | symbol, receiver: any): any;
    
    /**
     * Sets trap.
     */
    set?(target: T, key: string | symbol, value: any, receiver: any): boolean;
    
    /**
     * Has trap.
     */
    has?(target: T, key: string | symbol): boolean;
    
    /**
     * Delete property trap.
     */
    deleteProperty?(target: T, key: string | symbol): boolean;
    
    /**
     * Own keys trap.
     */
    ownKeys?(target: T): ArrayLike<string | symbol>;
    
    /**
     * Get prototype trap.
     */
    getPrototypeOf?(target: T): object | null;
    
    /**
     * Set prototype trap.
     */
    setPrototypeOf?(target: T, prototype: object | null): boolean;
    
    /**
     * Is extensible trap.
     */
    isExtensible?(target: T): boolean;
    
    /**
     * Prevent extensions trap.
     */
    preventExtensions?(target: T): boolean;
    
    /**
     * Get descriptor trap.
     */
    getOwnPropertyDescriptor?(target: T, key: string | symbol): PropertyDescriptor | undefined;
    
    /**
     * Apply trap.
     */
    apply?(target: T, thisArg: any, argArray?: any): any;
    
    /**
     * Construct trap.
     */
    construct?(target: T, argArray: any, newTarget?: Function): object;
  }
}

// Add Generator and Iterator types
declare namespace Bun {
  interface Generator<T = any, TReturn = any, TNext = unknown> extends Iterator<T, TReturn, TNext> {
    /**
     * Next iteration.
     */
    next(...args: [] | [TNext]): IteratorResult<T, TReturn>;
    
    /**
     * Returns value and completes generator.
     */
    return(value: TReturn): IteratorResult<T, TReturn>;
    
    /**
     * Throws error into generator.
     */
    throw(e: any): IteratorResult<T, TReturn>;
    
    /**
     * Generator symbol.
     */
    readonly [Symbol.toStringTag]: string;
  }
  
  interface AsyncGenerator<T = any, TReturn = any, TNext = unknown> extends AsyncIterator<T, TReturn, TNext> {
    /**
     * Next iteration.
     */
    next(...args: [] | [TNext]): Promise<IteratorResult<T, TReturn>>;
    
    /**
     * Returns value and completes generator.
     */
    return(value: TReturn): Promise<IteratorResult<T, TReturn>>;
    
    /**
     * Throws error into generator.
     */
    throw(e: any): Promise<IteratorResult<T, TReturn>>;
  }
}

// Add Set and Map collection types
declare namespace Bun {
  interface Set<T> {
    /**
     * Adds value to set.
     */
    add(value: T): this;
    
    /**
     * Checks if value exists.
     */
    has(value: T): boolean;
    
    /**
     * Deletes value from set.
     */
    delete(value: T): boolean;
    
    /**
     * Clears all values.
     */
    clear(): void;
    
    /**
     * Gets set size.
     */
    readonly size: number;
    
    /**
     * Iterates over values.
     */
    forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void, thisArg?: any): void;
    
    /**
     * Returns values iterator.
     */
    keys(): IterableIterator<T>;
    
    /**
     * Returns values iterator.
     */
    values(): IterableIterator<T>;
    
    /**
     * Returns entries iterator.
     */
    entries(): IterableIterator<[T, T]>;
  }
}

// Add WeakSet and WeakMap types
declare namespace Bun {
  interface WeakSet<T extends object> {
    /**
     * Adds value to weak set.
     */
    add(value: T): this;
    
    /**
     * Checks if value exists.
     */
    has(value: T): boolean;
    
    /**
     * Deletes value from weak set.
     */
    delete(value: T): boolean;
  }
  
  interface WeakMap<K extends object, V> {
    /**
     * Sets value in weak map.
     */
    set(key: K, value: V): this;
    
    /**
     * Gets value from weak map.
     */
    get(key: K): V | undefined;
    
    /**
     * Checks if key exists.
     */
    has(key: K): boolean;
    
    /**
     * Deletes key from weak map.
     */
    delete(key: K): boolean;
  }
}

// Add URL and URLPattern types
declare namespace Bun {
  interface URL {
    /**
     * Protocol scheme.
     */
    protocol: string;
    
    /**
     * Hostname.
     */
    hostname: string;
    
    /**
     * Port number.
     */
    port: string;
    
    /**
     * Pathname.
     */
    pathname: string;
    
    /**
     * Query string.
     */
    search: string;
    
    /**
     * Hash fragment.
     */
    hash: string;
    
    /**
     * Username.
     */
    username: string;
    
    /**
     * Password.
     */
    password: string;
    
    /**
     * Origin.
     */
    origin: string;
    
    /**
     * Full href.
     */
    href: string;
  }
  
  interface URLPattern {
    /**
     * Tests if URL matches pattern.
     */
    test(url: string | URL): boolean;
    
    /**
     * Executes pattern match.
     */
    exec(url: string | URL): URLPatternResult | null;
    
    /**
     * Pattern string.
     */
    readonly pattern: string;
  }
}

// Add Error types
declare namespace Bun {
  interface Error {
    /**
     * Error name.
     */
    name: string;
    
    /**
     * Error message.
     */
    message: string;
    
    /**
     * Stack trace.
     */
    stack?: string;
    
    /**
     * Error cause.
     */
    cause?: unknown;
    
    /**
     * Error code.
     */
    code?: string | number;
  }
  
  interface ErrorConstructor {
    /**
     * Creates error instance.
     */
    new(message?: string, options?: { cause?: unknown }): Error;
  }
}

// Add Performance API types
declare namespace Bun {
  interface Performance {
    /**
     * Gets current time in milliseconds.
     */
    now(): number;
    
    /**
     * Measures time from mark.
     */
    measure(name: string, startMark?: string, endMark?: string): PerformanceMeasure;
    
    /**
     * Creates performance mark.
     */
    mark(name: string): void;
    
    /**
     * Clears marks.
     */
    clearMarks(name?: string): void;
    
    /**
     * Clears measures.
     */
    clearMeasures(name?: string): void;
    
    /**
     * Clears resource timings.
     */
    clearResourceTimings(): void;
    
    /**
     * Gets performance entries.
     */
    getEntries(): PerformanceEntry[];
    
    /**
     * Gets entries by type.
     */
    getEntriesByType(type: string): PerformanceEntry[];
    
    /**
     * Gets entry by name.
     */
    getEntriesByName(name: string, type?: string): PerformanceEntry[];
  }
  
  interface PerformanceEntry {
    /**
     * Entry name.
     */
    name: string;
    
    /**
     * Entry type.
     */
    entryType: string;
    
    /**
     * Start time.
     */
    startTime: number;
    
    /**
     * Duration.
     */
    duration: number;
  }
}

// Add AbortController types
declare namespace Bun {
  interface AbortController {
    /**
     * Abort signal.
     */
    readonly signal: AbortSignal;
    
    /**
     * Aborts async operation.
     */
    abort(reason?: any): void;
  }
  
  interface AbortSignal extends EventTarget {
    /**
     * Is aborted?
     */
    readonly aborted: boolean;
    
    /**
     * Abort reason.
     */
    readonly reason: any;
    
    /**
     * Event: onabort.
     */
    onabort: ((this: AbortSignal, ev: Event) => any) | null;
    
    /**
     * Throws if aborted.
     */
    throwIfAborted(): void;
    
    /**
     * Static timeout method.
     */
    static timeout(ms: number): AbortSignal;
  }
  
  interface AbortOptions {
    /**
     * Abort signal.
     */
    signal?: AbortSignal;
    
    /**
     * Timeout in milliseconds.
     */
    timeout?: number;
  }
}

// Add MessageChannel and MessagePort types
declare namespace Bun {
  interface MessageChannel {
    /**
     * Port 1.
     */
    readonly port1: MessagePort;
    
    /**
     * Port 2.
     */
    readonly port2: MessagePort;
  }
  
  interface MessagePort extends EventTarget {
    /**
     * Posts message.
     */
    postMessage(message: any, transfer?: any[]): void;
    
    /**
     * Starts port.
     */
    start(): void;
    
    /**
     * Closes port.
     */
    close(): void;
    
    /**
     * Event: onmessage.
     */
    onmessage: ((this: MessagePort, ev: MessageEvent) => any) | null;
    
    /**
     * Event: onmessageerror.
     */
    onmessageerror: ((this: MessagePort, ev: MessageEvent) => any) | null;
  }
}

// Add Storage API types
declare namespace Bun {
  interface Storage {
    /**
     * Storage length.
     */
    readonly length: number;
    
    /**
     * Gets item by key.
     */
    getItem(key: string): string | null;
    
    /**
     * Sets item.
     */
    setItem(key: string, value: string): void;
    
    /**
     * Removes item.
     */
    removeItem(key: string): void;
    
    /**
     * Clears all items.
     */
    clear(): void;
    
    /**
     * Gets key at index.
     */
    key(index: number): string | null;
    
    /**
     * Iterates over items.
     */
    forEach(callbackfn: (value: string, key: string, parent: Storage) => void, thisArg?: any): void;
  }
}

// Add CustomEvent types
declare namespace Bun {
  interface CustomEventInit<T = any> {
    /**
     * Event detail data.
     */
    detail?: T;
    
    /**
     * Event bubbles.
     */
    bubbles?: boolean;
    
    /**
     * Event cancelable.
     */
    cancelable?: boolean;
    
    /**
     * Event composed.
     */
    composed?: boolean;
  }
  
  interface CustomEvent<T = any> extends Event {
    /**
     * Event detail.
     */
    readonly detail: T;
    
    /**
     * Initializes event.
     */
    initCustomEvent(type: string, options?: CustomEventInit<T>): void;
  }
  
  interface EventInit {
    bubbles?: boolean;
    cancelable?: boolean;
    composed?: boolean;
  }
  
  interface Event {
    /**
     * Event type.
     */
    readonly type: string;
    
    /**
     * Event target.
     */
    readonly target: EventTarget | null;
    
    /**
     * Current target.
     */
    readonly currentTarget: EventTarget | null;
    
    /**
     * Event bubbles.
     */
    readonly bubbles: boolean;
    
    /**
     * Event cancelable.
     */
    readonly cancelable: boolean;
    
    /**
     * Event default prevented.
     */
    readonly defaultPrevented: boolean;
    
    /**
     * Event timestamp.
     */
    readonly timeStamp: number;
    
    /**
     * Stops propagation.
     */
    stopPropagation(): void;
    
    /**
     * Stops immediate propagation.
     */
    stopImmediatePropagation(): void;
    
    /**
     * Prevents default.
     */
    preventDefault(): void;
    
    /**
     * Composed path.
     */
    composedPath(): EventTarget[];
  }
}

// Add EventTarget types
declare namespace Bun {
  interface EventTarget {
    /**
     * Adds event listener.
     */
    addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): void;
    
    /**
     * Removes event listener.
     */
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions): void;
    
    /**
     * Dispatches event.
     */
    dispatchEvent(event: Event): boolean;
  }
  
  interface EventListenerOptions {
    /**
     * Capture phase.
     */
    capture?: boolean;
    
    /**
     * Once flag.
     */
    once?: boolean;
    
    /**
     * Passive flag.
     */
    passive?: boolean;
    
    /**
     * Signal.
     */
    signal?: AbortSignal;
  }
  
  interface AddEventListenerOptions extends EventListenerOptions {
    /**
     * Listener object.
     */
    once?: boolean;
    /**
     * Passive flag.
     */
    passive?: boolean;
  }
  
  type EventListenerOrEventListenerObject = EventListener | EventListenerObject;
  
  interface EventListener {
    (evt: Event): void;
  }
  
  interface EventListenerObject {
    handleEvent(object: Event): void;
  }
}

// Add FormData types
declare namespace Bun {
  interface FormData {
    /**
     * Appends value.
     */
    append(name: string, value: string | Blob): void;
    
    /**
     * Appends value with filename.
     */
    append(name: string, value: string | Blob, filename?: string): void;
    
    /**
     * Deletes value.
     */
    delete(name: string): void;
    
    /**
     * Gets value.
     */
    get(name: string): FormDataEntryValue | null;
    
    /**
     * Gets all values.
     */
    getAll(name: string): FormDataEntryValue[];
    
    /**
     * Checks if key exists.
     */
    has(name: string): boolean;
    
    /**
     * Sets value.
     */
    set(name: string, value: string | Blob): void;
    
    /**
     * Iterates over entries.
     */
    forEach(callbackfn: (value: FormDataEntryValue, key: string, parent: FormData) => void, thisArg?: any): void;
    
    /**
     * Form data entries.
     */
    entries(): IterableIterator<[string, FormDataEntryValue]>;
    
    /**
     * Form data keys.
     */
    keys(): IterableIterator<string>;
    
    /**
     * Form data values.
     */
    values(): IterableIterator<FormDataEntryValue>;
    
    /**
     * Form data length.
     */
    readonly [Symbol.iterator]: () => IterableIterator<[string, FormDataEntryValue]>;
  }
  
  type FormDataEntryValue = File | string;
}

// Add Headers types
declare namespace Bun {
  interface Headers {
    /**
     * Appends header value.
     */
    append(name: string, value: string): void;
    
    /**
     * Deletes header.
     */
    delete(name: string): void;
    
    /**
     * Gets header value.
     */
    get(name: string): string | null;
    
    /**
     * Checks if header exists.
     */
    has(name: string): boolean;
    
    /**
     * Sets header value.
     */
    set(name: string, value: string): void;
    
    /**
     * Iterates over headers.
     */
    forEach(callbackfn: (value: string, key: string, parent: Headers) => void, thisArg?: any): void;
    
    /**
     * Headers entries.
     */
    entries(): IterableIterator<[string, string]>;
    
    /**
     * Header keys.
     */
    keys(): IterableIterator<string>;
    
    /**
     * Header values.
     */
    values(): IterableIterator<string>;
    
    /**
     * Headers iterator.
     */
    readonly [Symbol.iterator]: () => IterableIterator<[string, string]>;
  }
}

// Add Request and Response types
declare namespace Bun {
  interface Request {
    /**
     * Request URL.
     */
    readonly url: string;
    
    /**
     * Request method.
     */
    readonly method: string;
    
    /**
     * Request headers.
     */
    readonly headers: Headers;
    
    /**
     * Request body.
     */
    readonly body: ReadableStream | null;
    
    /**
     * Request mode.
     */
    readonly mode: RequestMode;
    
    /**
     * Request credentials.
     */
    readonly credentials: RequestCredentials;
    
    /**
     * Request cache.
     */
    readonly cache: RequestCache;
    
    /**
     * Request redirect.
     */
    readonly redirect: RequestRedirect;
    
    /**
     * Request referrer.
     */
    readonly referrer: string;
    
    /**
     * Request referrer policy.
     */
    readonly referrerPolicy: ReferrerPolicy;
    
    /**
     * Clones request.
     */
    clone(): Request;
  }
  
  interface ResponseInit {
    /**
     * Response status.
     */
    status?: number;
    
    /**
     * Response status text.
     */
    statusText?: string;
    
    /**
     * Response headers.
     */
    headers?: HeadersInit;
  }
}

// Add WebSocket types
declare namespace Bun {
  interface WebSocket {
    /**
     * WebSocket URL.
     */
    readonly url: string;
    
    /**
     * Connection state.
     */
    readonly readyState: number;
    
    /**
     * CONNECTING = 0
     */
    readonly CONNECTING: 0;
    
    /**
     * OPEN = 1
     */
    readonly OPEN: 1;
    
    /**
     * CLOSING = 2
     */
    readonly CLOSING: 2;
    
    /**
     * CLOSED = 3
     */
    readonly CLOSED: 3;
    
    /**
     * Buffered amount.
     */
    readonly bufferedAmount: number;
    
    /**
     * Extensions.
     */
    readonly extensions: string;
    
    /**
     * Protocol.
     */
    readonly protocol: string;
    
    /**
     * Sends data.
     */
    send(data: string | Buffer | ArrayBuffer): void;
    
    /**
     * Closes connection.
     */
    close(code?: number, reason?: string): void;
    
    /**
     * Event: onopen.
     */
    onopen: ((this: WebSocket, ev: Event) => any) | null;
    
    /**
     * Event: onmessage.
     */
    onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null;
    
    /**
     * Event: onerror.
     */
    onerror: ((this: WebSocket, ev: Event) => any) | null;
    
    /**
     * Event: onclose.
     */
    onclose: ((this: WebSocket, ev: CloseEvent) => any) | null;
  }
}

// Add Location and History types
declare namespace Bun {
  interface Location {
    /**
     * Full href.
     */
    href: string;
    
    /**
     * Protocol.
     */
    protocol: string;
    
    /**
     * Hostname.
     */
    hostname: string;
    
    /**
     * Port.
     */
    port: string;
    
    /**
     * Pathname.
     */
    pathname: string;
    
    /**
     * Search string.
     */
    search: string;
    
    /**
     * Hash fragment.
     */
    hash: string;
    
    /**
     * Origin.
     */
    readonly origin: string;
    
    /**
     * Assigns new URL.
     */
    assign(url: string): void;
    
    /**
     * Replaces URL.
     */
    replace(url: string): void;
    
    /**
     * Reloads page.
     */
    reload(): void;
  }
  
  interface History {
    /**
     * History length.
     */
    readonly length: number;
    
    /**
     * Goes back.
     */
    back(): void;
    
    /**
     * Goes forward.
     */
    forward(): void;
    
    /**
     * Goes to delta.
     */
    go(delta?: number): void;
    
    /**
     * Pushes state.
     */
    pushState(state: any, title: string, url?: string): void;
    
    /**
     * Replaces state.
     */
    replaceState(state: any, title: string, url?: string): void;
    
    /**
     * Gets current state.
     */
    readonly state: any;
  }
}

// Add additional Node.js global types
declare namespace NodeJS {
  interface ProcessEnv {
    /**
     * NODE_ENV environment variable.
     */
    NODE_ENV?: 'development' | 'production' | 'test';
    
    /**
     * BUN_DEBUG environment variable.
     */
    BUN_DEBUG?: '1' | '0';
    
    /**
     * TZ (timezone) environment variable.
     */
    TZ?: string;
  }
  
  interface Timeout extends Timer {
    /**
     * Refreshest timer.
     */
    refresh(): this;
    
    /**
     * Gets timer value.
     */
    [Symbol.toPrimitive](): number;
  }
  
  interface Immediate extends Timer {
    /**
     * Clears immediate.
     */
    _onImmediate: Function;
  }
}

// Add Console constructor types
declare namespace NodeJS {
  interface ConsoleConstructor {
    /**
     * Standard output stream.
     */
    stdout: WriteStream;
    
    /**
     * Standard error stream.
     */
    stderr: WriteStream;
    
    /**
     * Creates new Console instance.
     */
    new(options?: ConsoleConstructorOptions): Console;
    
    /**
     * Creates console with stdout and stderr.
     */
    new(stdout: WritableStream, stderr?: WritableStream): Console;
  }
  
  interface ConsoleConstructorOptions {
    /**
     * Ignore errors?
     */
    ignoreErrors?: boolean;
    
    /**
     * Use color?
     */
    colorMode?: boolean | 'auto';
    
    /**
     * Inspect options.
     */
    inspectOptions?: InspectOptions;
    
    /**
     * Group indent level.
     */
    groupIndentLevel?: number;
  }
  
  interface WriteStream extends Writable {
    /**
     * File descriptor.
     */
    fd: number;
    
    /**
     * Is a TTY?
     */
    isTTY: boolean;
  }
}

// Add Module types
declare namespace NodeJS {
  interface Module {
    /**
     * Module exports.
     */
    exports: any;
    
    /**
     * Module ID.
     */
    id: string;
    
    /**
     * Module filename.
     */
    filename: string | null;
    
    /**
     * Module loaded status.
     */
    loaded: boolean;
    
    /**
     * Parent module.
     */
    parent: Module | null;
    
    /**
     * Child modules.
     */
    children: Module[];
    
    /**
     * Module paths.
     */
    paths: string[];
    
    /**
     * Require function.
     */
    require(id: string): any;
  }
  
  interface Require {
    /**
     * Requires module.
     */
    (id: string): any;
    
    /**
     * Resolves module path.
     */
    resolve(id: string): string;
    
    /**
     * Resolves module paths.
     */
    paths(): string[];
    
    /**
     * Cache of modules.
     */
    cache: RequireCache;
  }
  
  interface RequireCache {
    [id: string]: any;
  }
}

// Add Readable and Writable stream base types
declare namespace NodeJS {
  interface ReadableStream extends EventEmitter {
    /**
     * Is paused?
     */
    readable: boolean;
    
    /**
     * Is flowing?
     */
    readableFlowing: boolean | null;
    
    /**
     * Is destroyed?
     */
    readableDestroyed: boolean;
    
    /**
     * Reads data.
     */
    read(size?: number): any;
    
    /**
     * Sets encoding.
     */
    setEncoding(encoding: BufferEncoding): this;
    
    /**
     * Pauses stream.
     */
    pause(): this;
    
    /**
     * Resumes stream.
     */
    resume(): this;
    
    /**
     * Is stream paused?
     */
    isPaused(): boolean;
    
    /**
     * Pipes to destination.
     */
    pipe<T extends WritableStream>(destination: T, options?: { end?: boolean }): T;
    
    /**
     * Unpipes.
     */
    unpipe(destination?: WritableStream): this;
    
    /**
     * Destroys stream.
     */
    destroy(error?: Error): void;
    
    /**
     * Event: data.
     */
    on(event: 'data', listener: (chunk: any) => void): this;
    
    /**
     * Event: end.
     */
    on(event: 'end', listener: () => void): this;
    
    /**
     * Event: error.
     */
    on(event: 'error', listener: (err: Error) => void): this;
    
    /**
     * Event: close.
     */
    on(event: 'close', listener: () => void): this;
  }
  
  interface WritableStream extends EventEmitter {
    /**
     * Is writable?
     */
    writable: boolean;
    
    /**
     * Is destroyed?
     */
    writableDestroyed: boolean;
    
    /**
     * Writes data.
     */
    write(chunk: any, encoding?: BufferEncoding | callback, callback?: Function): boolean;
    
    /**
     * Writes multiple chunks.
     */
    writev(chunks: Array<{ chunk: any; encoding: BufferEncoding }>, callback?: Function): boolean;
    
    /**
     * Ends stream.
     */
    end(chunk?: any, encoding?: BufferEncoding | callback, callback?: Function): void;
    
    /**
     * Sets default encoding.
     */
    setDefaultEncoding(encoding: BufferEncoding): this;
    
    /**
     * Closes stream.
     */
    destroy(error?: Error): void;
    
    /**
     * Event: drain.
     */
    on(event: 'drain', listener: () => void): this;
    
    /**
     * Event: finish.
     */
    on(event: 'finish', listener: () => void): this;
    
    /**
     * Event: error.
     */
    on(event: 'error', listener: (err: Error) => void): this;
    
    /**
     * Event: close.
     */
    on(event: 'close', listener: () => void): this;
    
    /**
     * Event: pipe.
     */
    on(event: 'pipe', listener: (src: ReadableStream) => void): this;
    
    /**
     * Event: unpipe.
     */
    on(event: 'unpipe', listener: (src: ReadableStream) => void): this;
  }
}

// Add Duplex and Transform stream types
declare namespace NodeJS {
  interface DuplexStream extends ReadableStream, WritableStream {
    /**
     * Allows half-open streams.
     */
    allowHalfOpen: boolean;
  }
  
  interface TransformStream extends DuplexStream {
    /**
     * Transforms data.
     */
    _transform(chunk: any, encoding: BufferEncoding, callback: Function): void;
    
    /**
     * Flushes data.
     */
    _flush(callback: Function): void;
  }
  
  interface PassThrough extends TransformStream {}
}

// Add FileHandle and File system types
declare namespace NodeJS {
  interface FileHandle {
    /**
     * File descriptor.
     */
    readonly fd: number;
    
    /**
     * Reads file.
     */
    read(buffer: Buffer, offset?: number, length?: number, position?: number): Promise<{ bytesRead: number; buffer: Buffer }>;
    
    /**
     * Writes file.
     */
    write(buffer: Buffer, offset?: number, length?: number, position?: number): Promise<{ bytesWritten: number; buffer: Buffer }>;
    
    /**
     * Gets file stats.
     */
    stat(): Promise<Stats>;
    
    /**
     * Truncates file.
     */
    truncate(len?: number): Promise<void>;
    
    /**
     * Closes file handle.
     */
    close(): Promise<void>;
  }
  
  interface Stats {
    /**
     * Is directory?
     */
    isDirectory(): boolean;
    
    /**
     * Is file?
     */
    isFile(): boolean;
    
    /**
     * Is symbolic link?
     */
    isSymbolicLink(): boolean;
    
    /**
     * Is block device?
     */
    isBlockDevice(): boolean;
    
    /**
     * Is character device?
     */
    isCharacterDevice(): boolean;
    
    /**
     * Is FIFO?
     */
    isFIFO(): boolean;
    
    /**
     * Is socket?
     */
    isSocket(): boolean;
    
    /**
     * Device ID.
     */
    dev: number;
    
    /**
     * Inode number.
     */
    ino: number;
    
    /**
     * Mode.
     */
    mode: number;
    
    /**
     * Number of hard links.
     */
    nlink: number;
    
    /**
     * User ID.
     */
    uid: number;
    
    /**
     * Group ID.
     */
    gid: number;
    
    /**
     * Device ID (if special file).
     */
    rdev: number;
    
    /**
     * Size in bytes.
     */
    size: number;
    
    /**
     * Block size for I/O.
     */
    blksize: number;
    
    /**
     * Number of 512-byte blocks allocated.
     */
    blocks: number;
    
    /**
     * Last access time.
     */
    atimeMs: number;
    
    /**
     * Last modification time.
     */
    mtimeMs: number;
    
    /**
     * Last change time.
     */
    ctimeMs: number;
    
    /**
     * Birth time.
     */
    birthtimeMs: number;
    
    /**
     * Last access time Date.
     */
    atime: Date;
    
    /**
     * Last modification time Date.
     */
    mtime: Date;
    
    /**
     * Last change time Date.
     */
    ctime: Date;
    
    /**
     * Birth time Date.
     */
    birthtime: Date;
  }
}

// Add PathLike and Buffer types
declare namespace NodeJS {
  type PathLike = string | Buffer | URL;
  
  interface Buffer extends Uint8Array {
    /**
     * Writes string to buffer.
     */
    write(string: string, offset?: number, length?: number, encoding?: BufferEncoding): number;
    
    /**
     * Concatenates buffers.
     */
    concat(list: Buffer[] | Buffer[][], totalLength?: number): Buffer;
    
    /**
     * Allocates buffer.
     */
    alloc(size: number, fill?: string | Buffer | number, encoding?: BufferEncoding): Buffer;
    
    /**
     * Allocates uninitialized buffer.
     */
    allocUnsafe(size: number): Buffer;
    
    /**
     * Allocates uninitialized slow buffer.
     */
    allocUnsafeSlow(size: number): Buffer;
    
    /**
     * Creates buffer from string.
     */
    from(string: string | Buffer | ArrayBuffer, encoding?: BufferEncoding): Buffer;
    
    /**
     * Checks if is buffer.
     */
    isBuffer(obj: any): obj is Buffer;
    
    /**
     * Byte length.
     */
    byteLength(string: string, encoding?: BufferEncoding): number;
    
    /**
     * Converts to JSON.
     */
    toJSON(): { type: 'Buffer', data: number[] };
  }
  
  type BufferEncoding = 'ascii' | 'base64' | 'base64url' | 'hex' | 'utf8' | 'utf-8' | 'binary' | 'ucs2' | 'ucs-2' | 'utf16le' | 'utf-16le';
}

// Add ERRORS and domain types
declare namespace NodeJS {
  interface ErrnoException extends Error {
    /**
     * Error code.
     */
    code?: string;
    
    /**
     * Error number.
     */
    errno?: number;
    
    /**
     * System call.
     */
    syscall?: string;
    
    /**
     * Path.
     */
    path?: string;
    
    /**
     * Destination path.
     */
    dest?: string;
  }
  
  interface Domain extends EventEmitter {
    /**
     * Runs code in domain context.
     */
    run(fn: Function): void;
    
    /**
     * Adds member to domain.
     */
    add(emitter: EventEmitter): void;
    
    /**
     * Removes member from domain.
     */
    remove(emitter: EventEmitter): void;
    
    /**
     * Binds to domain.
     */
    bind(emitter: EventEmitter): void;
    
    /**
     * Domain members.
     */
    members: Array<EventEmitter>;
  }
}

// Add TTY types
declare namespace NodeJS {
  interface ReadStream extends ReadableStream {
    /**
     * Is a TTY?
     */
    isTTY: boolean;
    
    /**
     * Gets/set columns.
     */
    columns: number;
    
    /**
     * Gets/set rows.
     */
    rows: number;
    
    /**
     * Window size.
     */
    getWindowSize(): [columns: number, rows: number];
  }
  
  interface WriteStream extends WritableStream {
    /**
     * Is a TTY?
     */
    isTTY: boolean;
    
    /**
     * Gets/set columns.
     */
    columns: number;
    
    /**
     * Gets/set rows.
     */
    rows: number;
    
    /**
     * Moves cursor.
     */
    moveCursor(dx: number, dy: number, callback?: Function): void;
    
    /**
     * Clears line.
     */
    clearLine(dir: number, callback?: Function): void;
    
    /**
     * Clears screen down.
     */
    clearScreenDown(callback?: Function): void;
    
    /**
     * Gets window size.
     */
    getWindowSize(): [columns: number, rows: number];
    
    /**
     * Gets/set raw mode.
     */
    setRawMode(mode: boolean): this;
  }
}

// Add Child Process types
declare namespace NodeJS {
  interface ChildProcess extends EventEmitter {
    /**
     * Process ID.
     */
    readonly pid: number;
    
    /**
     * Stdin stream.
     */
    readonly stdin: WritableStream;
    
    /**
     * Stdout stream.
     */
    readonly stdout: ReadableStream;
    
    /**
     * Stderr stream.
     */
    readonly stderr: ReadableStream;
    
    /**
     * Connected?
     */
    readonly connected: boolean;
    
    /**
     * Exit code.
     */
    readonly exitCode: number | null;
    
    /**
     * Signal received.
     */
    readonly signalCode: string | null;
    
    /**
     * Spawn arguments.
     */
    readonly spawnargs: string[];
    
    /**
     * Kills process.
     */
    kill(signal?: string): void;
    
    /**
     * Sends signal.
     */
    send(message: any, handle?: any, callback?: Function): boolean;
    
    /**
     * Disconnects IPC.
     */
    disconnect(): void;
    
    /**
     * Refs process.
     */
    ref(): this;
    
    /**
     * Unrefs process.
     */
    unref(): this;
    
    /**
     * Event: close.
     */
    on(event: 'close', listener: (code: number, signal: string) => void): this;
    
    /**
     * Event: disconnect.
     */
    on(event: 'disconnect', listener: () => void): this;
    
    /**
     * Event: error.
     */
    on(event: 'error', listener: (err: Error) => void): this;
    
    /**
     * Event: exit.
     */
    on(event: 'exit', listener: (code: number | null, signal: string | null) => void): this;
    
    /**
     * Event: message.
     */
    on(event: 'message', listener: (message: any) => void): this;
  }
  
  interface SpawnOptions {
    /**
     * Command line arguments.
     */
    args?: string[];
    
    /**
     * Working directory.
     */
    cwd?: string;
    
    /**
     * Environment variables.
     */
    env?: Record<string, string>;
    
    /**
     * Stdio configuration.
     */
    stdio?: Array<string | Stream | 'pipe' | 'inherit' | 'ignore' | number>;
    
    /**
     * Detached?
     */
    detached?: boolean;
    
    /**
     * UID.
     */
    uid?: number;
    
    /**
     * GID.
     */
    gid?: number;
    
    /**
     * Shell option.
     */
    shell?: boolean | string;
    
    /**
     * Windows flag.
     */
    windowsVerbatimArguments?: boolean;
    
    /**
     * Windows hide.
     */
    windowsHide?: boolean;
  }
}

// Add Cluster types
declare namespace NodeJS {
  interface Cluster extends EventEmitter {
    /**
     * Worker instances.
     */
    readonly workers: Worker[];
    
    /**
     * Is primary?
     */
    readonly isPrimary: boolean;
    
    /**
     * Is master?
     */
    readonly isMaster: boolean;
    
    /**
     * Is worker?
     */
    readonly isWorker: boolean;
    
    /**
     * Worker ID.
     */
    readonly id?: number;
    
    /**
     * Cluster settings.
     */
    readonly settings: ClusterSettings;
    
    /**
     * Forks worker.
     */
    fork(env?: Record<string, string>): Worker;
    
    /**
     * Disconnects cluster.
     */
    disconnect(callback?: Function): void;
    
    /**
     * Sets up worker.
     */
    setupPrimary(settings?: ClusterSettings): void;
    
    /**
     * Sets up worker.
     */
    setupWorker(settings?: ClusterSettings): void;
    
    /**
     * Event: fork.
     */
    on(event: 'fork', listener: (worker: Worker) => void): this;
    
    /**
     * Event: online.
     */
    on(event: 'online', listener: (worker: Worker) => void): this;
    
    /**
     * Event: listening.
     */
    on(event: 'listening', listener: (worker: Worker) => void): this;
    
    /**
     * Event: exit.
     */
    on(event: 'exit', listener: (worker: Worker, code: number, signal: string) => void): this;
  }
  
  interface ClusterSettings {
    /**
     * Exec path.
     */
    exec?: string;
    
    /**
     * Arguments.
     */
    args?: string[];
    
    /**
     * Silent mode.
     */
    silent?: boolean;
    
    /**
     * Workers count.
     */
    workers?: number;
  }
}

// Add Worker types
declare namespace NodeJS {
  interface Worker extends EventEmitter {
    /**
     * Worker thread ID.
     */
    readonly threadId: number;
    
    /**
     * Is active?
     */
    readonly isActive: boolean;
    
    /**
     * Worker resource limits.
     */
    readonly resourceLimits?: ResourceLimits;
    
    /**
     * Posts message.
     */
    postMessage(value: any, transferList?: any[]): void;
    
    /**
     * Terminates worker.
     */
    terminate(): void;
    
    /**
     * Refs worker.
     */
    ref(): void;
    
    /**
     * Unrefs worker.
     */
    unref(): void;
    
    /**
     * Event: message.
     */
    on(event: 'message', listener: (value: any) => void): this;
    
    /**
     * Event: online.
     */
    on(event: 'online', listener: () => void): this;
    
    /**
     * Event: exit.
     */
    on(event: 'exit', listener: (exitCode: number) => void): this;
    
    /**
     * Event: error.
     */
    on(event: 'error', listener: (err: Error) => void): this;
  }
  
  interface ResourceLimits {
    /**
     * Max size of young generation heap in MiB.
     */
    maxYoungGenerationSizeMb?: number;
    
    /**
     * Max size of old generation heap in MiB.
     */
    maxOldGenerationSizeMb?: number;
    
    /**
     * Max size of code space in MiB.
     */
    codeSizeMb?: number;
    
    /**
     * Max stack size in MiB.
     */
    stackSizeMb?: number;
  }
}

// Add QueryString types
declare namespace NodeJS {
  interface QueryString {
    /**
     * Stringifies object.
     */
    stringify(obj?: any, sep?: string, eq?: string, options?: QueryStringifyOptions): string;
    
    /**
     * Parses query string.
     */
    parse(str: string, sep?: string, eq?: string, options?: QueryStringParseOptions): any;
    
    /**
     * Escapes query string.
     */
    escape(str: string): string;
    
    /**
     * Unescapes query string.
     */
    unescape(str: string): string;
  }
  
  interface QueryStringifyOptions {
    /**
     * URL encode?
     */
    encodeURIComponent?: Function;
  }
  
  interface QueryStringParseOptions {
    /**
     * Max keys.
     */
    maxKeys?: number;
    
    /**
     * DecodeURIComponent function.
     */
    decodeURIComponent?: Function;
  }
}

// Add URL types
declare namespace NodeJS {
  interface URL extends URL {
    /**
     * Path to file.
     */
    path: string;
  }
  
  interface TextDecoder {
    /**
     * Decodes input.
     */
    decode(input?: BufferSource | ArrayBuffer, options?: { stream?: boolean }): string;
    
    /**
     * Encoding.
     */
    readonly encoding: string;
    
    /**
     * Fatal flag.
     */
    readonly fatal: boolean;
    
    /**
     * Ignore BOM flag.
     */
    readonly ignoreBOM: boolean;
  }
  
  interface TextEncoder {
    /**
     * Encodes input.
     */
    encode(input?: string): Uint8Array;
    
    /**
     * Encoding.
     */
    readonly encoding: 'utf-8';
    
    /**
     * Is UTF-8?
     */
    readonly utf8: true;
  }
}

// Add Crypto types
declare namespace NodeJS {
  interface Crypto {
    /**
     * Generates random bytes.
     */
    randomBytes(size: number, callback?: (err: Error | null, buf: Buffer) => void): Buffer;
    
    /**
     * Generates random UUID.
     */
    randomUUID(callback?: (err: Error | null, uuid: string) => void): string;
    
    /**
     * Pseudo-random bytes.
     */
    prng(size: number, callback?: (err: Error | null, buf: Buffer) => void): Buffer;
    
    /**
     * Random int.
     */
    randomInt(min: number, max: number): number;
    
    /**
     * Scramble bytes.
     */
    scrypt(password: string, salt: string, keylen: number, cost: number, callback?: (err: Error | null, derivedKey: Buffer) => void): Buffer;
  }
  
  interface Hash extends NodeJS.ReadableStream {
    /**
     * Updates hash.
     */
    update(data: string | Buffer | ArrayBuffer, encoding?: BufferEncoding): this;
    
    /**
     * Returns digest.
     */
    digest(encoding?: BufferEncoding): Buffer;
    
    /**
     * Copies hash.
     */
    copy(): Hash;
  }
  
  interface Hmac extends NodeJS.ReadableStream {
    /**
     * Updates HMAC.
     */
    update(data: string | Buffer | ArrayBuffer, encoding?: BufferEncoding): this;
    
    /**
     * Returns digest.
     */
    digest(encoding?: BufferEncoding): Buffer;
  }
  
  interface Cipher extends NodeJS.ReadableStream, NodeJS.WritableStream {
    /**
     * Updates cipher.
     */
    update(data: string | Buffer | ArrayBuffer, encoding?: BufferEncoding): this;
    
    /**
     * Finalizes cipher.
     */
    final(encoding?: BufferEncoding): Buffer;
    
    /**
     * Sets auth tag.
     */
    setAuthTag(tag: Buffer): this;
  }
  
  interface Decipher extends NodeJS.ReadableStream, NodeJS.WritableStream {
    /**
     * Updates decipher.
     */
    update(data: string | Buffer | ArrayBuffer, encoding?: BufferEncoding): this;
    
    /**
     * Finalizes decipher.
     */
    final(encoding?: BufferEncoding): Buffer;
    
    /**
     * Gets auth tag.
     */
    getAuthTag(): Buffer;
  }
}
