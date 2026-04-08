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

// Add HTTP types
declare namespace NodeJS {
  interface IncomingMessage extends ReadableStream {
    /**
     * HTTP version.
     */
    readonly httpVersion: string;
    
    /**
     * HTTP version major.
     */
    readonly httpVersionMajor: string;
    
    /**
     * HTTP version minor.
     */
    readonly httpVersionMinor: string;
    
    /**
     * Complete headers.
     */
    readonly headers: IncomingHttpHeaders;
    
    /**
     * Raw headers.
     */
    readonly rawHeaders: string[];
    
    /**
     * trailers.
     */
    readonly trailers: IncomingHttpHeaders;
    
    /**
     * Method (request only).
     */
    readonly method?: string;
    
    /**
     * URL (request only).
     */
    readonly url?: string;
    
    /**
     * Status code (response only).
     */
    readonly statusCode?: number;
    
    /**
     * Status message (response only).
     */
    readonly statusMessage?: string;
    
    /**
     * Socket.
     */
    readonly socket: Socket;
    
    /**
     * Aborts connection.
     */
    abort(): void;
    
    /**
     * Destroys message.
     */
    destroy(error?: Error): void;
  }
  
  interface ServerResponse extends WritableStream {
    /**
     * Status code.
     */
    statusCode: number;
    
    /**
     * Status message.
     */
    statusMessage: string;
    
    /**
     * Headers.
     */
    readonly headers: OutgoingHttpHeaders;
    
    /**
     * Trailers.
     */
    readonly trailers: OutgoingHttpHeaders;
    
    /**
     * Send date header?
     */
    sendDate: boolean;
    
    /**
     * Finished?
     */
    readonly finished: boolean;
    
    /**
     * Writes head.
     */
    writeHead(statusCode: number, statusMessage?: string, headers?: OutgoingHttpHeaders): this;
    
    /**
     * Writes continue.
     */
    writeContinue(): void;
    
    /**
     * Adds trailer.
     */
    addTrailers(trailers: OutgoingHttpHeaders): void;
    
    /**
     * Removes header.
     */
    removeHeader(name: string): void;
    
    /**
     * Gets header.
     */
    getHeader(name: string): string | string[] | undefined;
    
    /**
     * Sets header.
     */
    setHeader(name: string, value: string | string[]): this;
    
    /**
     * Gets header names.
     */
    getHeaderNames(): string[];
    
    /**
     * Has header.
     */
    hasHeader(name: string): boolean;
  }
}

// Add HTTP Server and Agent types
declare namespace NodeJS {
  interface HttpServer extends EventEmitter {
    /**
     * Server listening?
     */
    readonly listening: boolean;
    
    /**
     * Max connections.
     */
    maxConnections: number;
    
    /**
     * Connections count.
     */
    connections: number;
    
    /**
     * Timeout.
     */
    timeout: number;
    
    /**
     * Keep alive timeout.
     */
    keepAliveTimeout: number;
    
    /**
     * Headers timeout.
     */
    headersTimeout: number;
    
    /**
     * Listens on port.
     */
    listen(port?: number, hostname?: string, backlog?: number, callback?: Function): this;
    
    /**
     * Closes server.
     */
    close(callback?: Function): this;
    
    /**
     * Refs server.
     */
    ref(): this;
    
    /**
     * Unrefs server.
     */
    unref(): this;
    
    /**
     * Event: request.
     */
    on(event: 'request', listener: (req: IncomingMessage, res: ServerResponse) => void): this;
    
    /**
     * Event: connection.
     */
    on(event: 'connection', listener: (socket: Socket) => void): this;
    
    /**
     * Event: close.
     */
    on(event: 'close', listener: () => void): this;
    
    /**
     * Event: error.
     */
    on(event: 'error', listener: (err: Error) => void): this;
  }
  
  interface Agent {
    /**
     * Max sockets.
     */
    maxSockets: number;
    
    /**
     * Max free sockets.
     */
    maxFreeSockets: number;
    
    /**
     * Free sockets.
     */
    readonly freeSockets: number;
    
    /**
     * Sockets count.
     */
    readonly sockets: number;
    
    /**
     * Requests count.
     */
    readonly requests: number;
    
    /**
     * Destroys agent.
     */
    destroy(): void;
  }
}

// Add Socket and Net types
declare namespace NodeJS {
  interface Socket extends ReadableStream, WritableStream {
    /**
     * Socket ID.
     */
    readonly id: number;
    
    /**
     * Is ready?
     */
    readonly readyState: string;
    
    /**
     * Buffer size.
     */
    bufferSize: number;
    
    /**
     * Is paused?
     */
    readonly isPaused: boolean;
    
    /**
     * Local address.
     */
    readonly localAddress: string;
    
    /**
     * Local port.
     */
    readonly localPort: number;
    
    /**
     * Remote address.
     */
    readonly remoteAddress?: string;
    
    /**
     * Remote port.
     */
    readonly remotePort?: number;
    
    /**
     * Remote family.
     */
    readonly remoteFamily?: string;
    
    /**
     * Bytes read.
     */
    readonly bytesRead: number;
    
    /**
     * Bytes written.
     */
    readonly bytesWritten: number;
    
    /**
     * Timeout.
     */
    timeout: number;
    
    /**
     * Sets encoding.
     */
    setEncoding(encoding?: BufferEncoding): this;
    
    /**
     * Pauses socket.
     */
    pause(): this;
    
    /**
     * Resumes socket.
     */
    resume(): this;
    
    /**
     * Sets timeout.
     */
    setTimeout(timeout: number, callback?: Function): this;
    
    /**
     * Writes data.
     */
    write(buffer: Buffer | string): boolean;
    
    /**
     * Ends socket.
     */
    end(callback?: Function): void;
    
    /**
     * Destroys socket.
     */
    destroy(error?: Error): void;
    
    /**
     * Refs socket.
     */
    ref(): this;
    
    /**
     * Unrefs socket.
     */
    unref(): this;
    
    /**
     * Event: connect.
     */
    on(event: 'connect', listener: () => void): this;
    
    /**
     * Event: data.
     */
    on(event: 'data', listener: (data: Buffer) => void): this;
    
    /**
     * Event: end.
     */
    on(event: 'end', listener: () => void): this;
    
    /**
     * Event: close.
     */
    on(event: 'close', listener: (hadError: boolean) => void): this;
    
    /**
     * Event: error.
     */
    on(event: 'error', listener: (err: Error) => void): this;
    
    /**
     * Event: timeout.
     */
    on(event: 'timeout', listener: () => void): this;
  }
}

// Add Inspector and Debugger types
declare namespace NodeJS {
  interface Inspector {
    /**
     * Opens inspector.
     */
    open(port?: number, host?: string, wait?: boolean): void;
    
    /**
     * Closes inspector.
     */
    close(): void;
    
    /**
     * URL for inspector.
     */
    url(): string;
    
    /**
     * Console.
     */
    console: any;
  }
  
  interface ConsoleConstructor {
    /**
     * Creates new console.
     */
    new(stdout: WritableStream, stderr?: WritableStream, ignoreErrors?: boolean): Console;
  }
  
  interface Debug extends EventEmitter {
    /**
     * Debugger port.
     */
    readonly port: number;
    
    /**
     * Debugger host.
     */
    readonly host: string;
    
    /**
     * Sets breakpoint.
     */
    setBreakpoint(script: string, line: number, condition?: string, callback?: Function): number;
    
    /**
     * Clears breakpoint.
     */
    clearBreakpoint(script: string, line: number): void;
    
    /**
     * Sends command.
     */
    send(command: any): void;
  }
}

// Add VM types
declare namespace NodeJS {
  interface Script {
    /**
     * Cached data.
     */
    cachedData?: Buffer;
    
    /**
     * Produces cached data.
     */
    produceCachedData?: Buffer;
    
    /**
     * Script source.
     */
    readonly source: string;
  }
  
  interface Context extends EventEmitter {
    /**
     * Sandbox object.
     */
    readonly sandbox: Record<string, any>;
    
    /**
     * Compiles code.
     */
    compileFunction(code: string, params?: string[], options?: CompilationOptions): Function;
    
    /**
     * Runs code.
     */
    run(code: string, options?: RunningCodeOptions): any;
    
    /**
     * Event: error.
     */
    on(event: 'error', listener: (err: Error) => void): this;
  }
  
  interface RunningCodeOptions {
    /**
     * Filename.
     */
    filename?: string;
    
    /**
     * Line offset.
     */
    lineOffset?: number;
    
    /**
     * Column offset.
     */
    columnOffset?: number;
    
    /**
     * Display errors.
     */
    displayErrors?: boolean;
    
    /**
     * Timeout.
     */
    timeout?: number;
    
    /**
     * Break on sigint.
     */
    breakOnSigint?: boolean;
  }
  
  interface CompilationOptions {
    /**
     * Filename.
     */
    filename?: string;
    
    /**
     * Line offset.
     */
    lineOffset?: number;
    
    /**
     * Column offset.
     */
    columnOffset?: number;
    
    /**
     * Cached data.
     */
    cachedData?: Buffer;
    
    /**
     * Produce cached data.
     */
    produceCachedData?: boolean;
  }
}

// Add Zlib types
declare namespace NodeJS {
  interface ZlibOptions {
    /**
     * Compression level.
     */
    level?: number;
    
    /**
     * Window size.
     */
    windowBits?: number;
    
    /**
     * Memory level.
     */
    memLevel?: number;
    
    /**
     * Strategy.
     */
    strategy?: number;
    
    /**
     * Dictionary.
     */
    dictionary?: Buffer | NodeJS.ArrayBufferView;
  }
  
  interface BrotliOptions extends ZlibOptions {
    /**
     * Brotli quality.
     */
    quality?: number;
    
    /**
     * Brotli window size.
     */
    lgwin?: number;
    
    /**
     * Brotli block size.
     */
    lgblock?: number;
  }
  
  interface Gzip extends NodeJS.ReadableStream, NodeJS.WritableStream {
    /**
     * Flushes data.
     */
    flush(callback?: Function): void;
    
    /**
     * Closes stream.
     */
    close(callback?: Function): void;
  }
  
  interface Gunzip extends NodeJS.ReadableStream, NodeJS.WritableStream {
    /**
     * Flushes data.
     */
    flush(callback?: Function): void;
    
    /**
     * Closes stream.
     */
    close(callback?: Function): void;
  }
  
  interface Deflate extends NodeJS.ReadableStream, NodeJS.WritableStream {
    /**
     * Flushes data.
     */
    flush(callback?: Function): void;
    
    /**
     * Closes stream.
     */
    close(callback?: Function): void;
  }
  
  interface Inflate extends NodeJS.ReadableStream, NodeJS.WritableStream {
    /**
     * Flushes data.
     */
    flush(callback?: Function): void;
    
    /**
     * Closes stream.
     */
    close(callback?: Function): void;
  }
}

// Add REPL types
declare namespace NodeJS {
  interface REPLServer extends EventEmitter {
    /**
     * REPL context.
     */
    readonly context: Record<string, any>;
    
    /**
     * Input stream.
     */
    readonly inputStream: NodeJS.ReadableStream;
    
    /**
     * Output stream.
     */
    readonly outputStream: NodeJS.WritableStream;
    
    /**
     * REPL prompt.
     */
    prompt: string;
    
    /**
     * Eval function.
     */
    eval: Function;
    
    /**
     * Completes input.
     */
    complete(keyword: string): Array<{ snippet: string; type: string }>;
    
    /**
     * Displays prompt.
     */
    displayPrompt(preserveCursor?: boolean): this;
    
    /**
     * Clears context.
     */
    clearContext(): void;
    
    /**
     * Defines command.
     */
    defineCommand(keyword: string, cmd: REPLCommand): void;
  }
  
  interface REPLCommand {
    /**
     * Command help.
     */
    help: string;
    
    /**
     * Command action.
     */
    action: string | Function;
  }
  
  interface REPLEval {
    /**
     * Evaluates code.
     */
    (code: string, context: Record<string, any>, file: string, cb: Function): any;
  }
}

// Add TLS/SSL types
declare namespace NodeJS {
  interface TlsOptions {
    /**
     * Private key.
     */
    key?: string | Buffer | Array<Buffer | string>;
    
    /**
     * Certificate.
     */
    cert?: string | Buffer | Array<string | Buffer>;
    
    /**
     * CA certificates.
     */
    ca?: string | Buffer | Array<string | Buffer>;
    
    /**
     * CRL (Certificate Revocation List).
     */
    crl?: string | Buffer | Array<string | Buffer>;
    
    /**
     * Passphrase.
     */
    passphrase?: string;
    
    /**
     * PFX certificate.
     */
    pfx?: string | Buffer;
    
    /**
     * PFX passphrase.
     */
    passphrasePFX?: string;
    
    /**
     * Servername.
     */
    servername?: string;
    
    /**
     * Check server identity?
     */
    checkServerIdentity?: (servername: string, cert: any) => boolean;
    
    /**
     * Min DH size.
     */
    minDHSize?: number;
    
    /**
     * Reject unauthorized?
     */
    rejectUnauthorized?: boolean;
    
    /**
     * ALPN protocols.
     */
    ALPNProtocols?: string[];
    
    /**
     * SNICallback.
     */
    SNICallback?: (servername: string) => any;
    
    /**
     * Session timeout.
     */
    sessionTimeout?: number;
  }
  
  interface SecureContext extends EventEmitter {
    /**
     * Closes context.
     */
    close(callback?: Function): void;
    
    /**
     * Initializes context.
     */
    init(): void;
  }
}

// Add OS types
declare namespace NodeJS {
  interface Cpus {
    /**
     * CPU model.
     */
    model: string;
    
    /**
     * CPU speed in MHz.
     */
    speed: number;
    
    /**
     * User time.
     */
    times: {
      user: number;
      nice: number;
      sys: number;
      idle: number;
      irq: number;
    };
  }
  
  interface NetworkInterfaces {
    [name: string]: NetworkInterfaceBase[];
  }
  
  interface NetworkInterfaceBase {
    /**
     * Interface address.
     */
    address: string;
    
    /**
     * Netmask.
     */
    netmask: string;
    
    /**
     * Family.
     */
    family: 'IPv4' | 'IPv6';
    
    /**
     * MAC address.
     */
    mac: string;
    
    /**
     * Is internal?
     */
    internal: boolean;
    
    /**
     * Is loopback?
     */
    loopback: boolean;
    
    /**
     * Scope ID.
     */
    scopeid?: number;
    /**
     * CIDR.
     */
    cidr?: string;
  }
  
  interface UserInfo {
    /**
     * User ID.
     */
    uid: number;
    
    /**
     * Group ID.
     */
    gid: number;
    
    /**
     * Username.
     */
    username: string;
    
    /**
     * Home directory.
     */
    homedir: string;
    
    /**
     * Shell.
     */
    shell: string | null;
  }
}

// Add Util types
declare namespace NodeJS {
  interface InspectOptions {
    /**
     * Show hidden properties.
     */
    showHidden?: boolean;
    
    /**
     * Inspection depth.
     */
    depth?: number | null;
    
    /**
     * Colors.
     */
    colors?: boolean;
    
    /**
     * Custom inspect.
     */
    customInspect?: boolean;
    
    /**
     * Show proxy.
     */
    showProxy?: boolean;
    
    /**
     * Max array length.
     */
    maxArrayLength?: number | null;
    
    /**
     * Max string length.
     */
    maxStringLength?: number | null;
    
    /**
     * Break length.
     */
    breakLength?: number;
    
    /**
     * Compact.
     */
    compact?: boolean;
    
    /**
     * Sorted.
     */
    sorted?: boolean;
    
    /**
     * getters.
     */
    getters?: boolean;
    
    /**
     * setters.
     */
    setters?: boolean;
    
    /**
     * Numeric separators.
     */
    numericSeparator?: boolean;
  }
  
  interface TextFormatOptions {
    /**
     * Format options.
     */
    format?: Function;
    
    /**
     * Colors.
     */
    colors?: boolean;
  }
}

// Add Worker Threads types
declare namespace NodeJS {
  interface WorkerOptions {
    /**
     * Worker filename.
     */
    filename?: string;
    
    /**
     * Worker name.
     */
    name?: string;
    
    /**
     * Worker type.
     */
    type?: 'classic' | 'module';
    
    /**
     * Eval.
     */
    eval?: boolean;
    
    /**
     * Exec argv.
     */
    execArgv?: string[];
    
    /**
     * Worker arguments.
     */
    workerData?: any;
    
    /**
     * Resource limits.
     */
    resourceLimits?: ResourceLimits;
    
    /**
     * Track managed objects.
     */
      trackUnmanagedFds?: boolean;
  }
  
  interface WorkerInfo {
    /**
     * Worker thread ID.
     */
    threadId: number;
    
    /**
     * Worker resource usage.
     */
    resourceUsage?: {
      userCPUTime: number;
      systemCPUTime: number;
      maxRSS: number;
      userCPUTimeDelta: number;
      systemCPUTimeDelta: number;
      rssDelta: number;
    };
  }
}

// Add FS.promises types
declare namespace NodeJS {
  interface FileHandle {
    /**
     * Reads file.
     */
    read(buffer: Buffer, offset?: number, length?: number, position?: number): Promise<{ bytesRead: number; buffer: Buffer }>;
    
    /**
     * Writes file.
     */
    write(buffer: Buffer | string, offset?: number, length?: number, position?: number): Promise<{ bytesWritten: number; buffer: Buffer }>;
    
    /**
     * Gets file stats.
     */
    stat(): Promise<Stats>;
    
    /**
     * Truncates file.
     */
    truncate(len?: number): Promise<void>;
    
    /**
     * Chmods file.
     */
    chmod(mode: number): Promise<void>;
    
    /**
     * Chowns file.
     */
    chown(uid: number, gid: number): Promise<void>;
    
    /**
     * Closes file handle.
     */
    close(): Promise<void>;
  }
  
  interface StatWatcher extends EventEmitter {
    /**
     * File path.
     */
    path: string;
    
    /**
     * Stops watching.
     */
    stop(): void;
    
    /**
     * Event: change.
     */
    on(event: 'change', listener: (current: Stats, previous: Stats) => void): this;
  }
}

// Add Dgram (UDP) types
declare namespace NodeJS {
  interface Socket extends EventEmitter {
    /**
     * Socket address.
     */
    readonly address: AddressInfo;
    
    /**
     * Sends data.
     */
    send(msg: Buffer, port: number, address?: string, callback?: Function): void;
    
    /**
     * Binds socket.
     */
    bind(port?: number, address?: string, callback?: Function): void;
    
    /**
     * Closes socket.
     */
    close(callback?: Function): void;
    
    /**
     * Sets broadcast.
     */
    setBroadcast(flag: boolean): void;
    
    /**
     * Sets TTL.
     */
    setTTL(ttl: number): void;
    
    /**
     * Sets multicast TTL.
     */
    setMulticastTTL(ttl: number): void;
    
    /**
     * Sets multicast interface.
     */
    setMulticastInterface(multicastInterface: string): void;
    
    /**
     * Adds membership.
     */
    addMembership(multicastAddress: string, multicastInterface?: string): void;
    
    /**
     * Drops membership.
     */
    dropMembership(multicastAddress: string, multicastInterface?: string): void;
    
    /**
     * Refs socket.
     */
    ref(): this;
    
    /**
     * Unrefs socket.
     */
    unref(): this;
    
    /**
     * Event: message.
     */
    on(event: 'message', listener: (msg: Buffer, rinfo: RemoteInfo) => void): this;
    
    /**
     * Event: listening.
     */
    on(event: 'listening', listener: () => void): this;
    
    /**
     * Event: close.
     */
    on(event: 'close', listener: () => void): this;
    
    /**
     * Event: error.
     */
    on(event: 'error', listener: (err: Error) => void): this;
  }
  
  interface AddressInfo {
    /**
     * Address.
     */
    address: string;
    
    /**
     * Family.
     */
    family: string;
    
    /**
     * Port.
     */
    port: number;
  }
  
  interface RemoteInfo {
    /**
     * Address.
     */
    address: string;
    
    /**
     * Family.
     */
    family: string;
    
    /**
     * Port.
     */
    port: number;
    
    /**
     * Size.
     */
    size: number;
  }
}

// Add Trace Events types
declare namespace NodeJS {
  interface TracingChannel {
    /**
     * Channel subscribers.
     */
    readonly hasSubscribers: boolean;
    
    /**
     * Subscribes to channel.
     */
    subscribe(subscriber: TracingChannelSubscriber): void;
    
    /**
     * Unsubscribes from channel.
     */
    unsubscribe(subscriber: TracingChannelSubscriber): void;
    
    /**
     * Publishes to channel.
     */
    publish(message: any): void;
  }
  
  interface TracingChannelSubscriber {
    /**
     * Channel name.
     */
    readonly channel: string;
    
    /**
     * Subscriber callback.
     */
    on(message: any): void;
  }
  
  interface TraceEvent {
    /**
     * Timestamp.
     */
    timestamp: number;
    
    /**
     * Category.
     */
    category: string;
    
    /**
     * Event name.
     */
    name: string;
    
    /**
     * Event data.
     */
    data: any;
    
    /**
     * Process ID.
     */
    pid: number;
    
    /**
     * Thread ID.
     */
    tid: number;
  }
}

// Add AsyncHooks and AsyncResource types
declare namespace NodeJS {
  interface HookCallbacks {
    /**
     * Init callback.
     */
    init?(asyncId: number, type: string, triggerAsyncId: number, resource: object): void;
    
    /**
     * Before callback.
     */
    before?(asyncId: number): void;
    
    /**
     * After callback.
     */
    after?(asyncId: number): void;
    
    /**
     * Destroy callback.
     */
    destroy?(asyncId: number): void;
    
    /**
     * PromiseResolve callback.
     */
    promiseResolve?(asyncId: number): void;
  }
  
  interface AsyncHook {
    /**
     * Enables hooks.
     */
    enable(): void;
    
    /**
     * Disables hooks.
     */
    disable(): void;
    
    /**
     * Adds callbacks.
     */
    addCallbacks(callbacks: HookCallbacks): void;
    
    /**
     * Removes callbacks.
     */
    removeCallbacks(callbacks: HookCallbacks): void;
  }
  
  interface AsyncResource {
    /**
     * Async ID.
     */
    readonly asyncId: number;
    
    /**
     * Trigger async ID.
     */
    readonly triggerAsyncId: number;
    
    /**
     * Async resource type.
     */
    readonly type: string;
    
    /**
     * Runs function in async context.
     */
    run<T>(fn: () => T): T;
    
    /**
     * Runs function in async context (async).
     */
    runAsync<T>(fn: () => Promise<T>): Promise<T>;
    
    /**
     * Emits init.
     */
    emitInit(): void;
    
    /**
     * Emits destroy.
     */
    emitDestroy(): void;
    
    /**
     * Async resource.
     */
    readonly resource: object;
  }
}

// Add Readline types
declare namespace NodeJS {
  interface ReadLine extends EventEmitter {
    /**
     * Prompt string.
     */
    prompt: string;
    
    /**
     * Gets line.
     */
    question(query: string, callback?: (answer: string) => void): void;
    
    /**
     * Pauses readline.
     */
    pause(): this;
    
    /**
     * Resumes readline.
     */
    resume(): this;
    
    /**
     * Closes interface.
     */
    close(): void;
    
    /**
     * Writes to output.
     */
    write(data: string | Buffer, key?: string): void;
    
    /**
     * Event: line.
     */
    on(event: 'line', listener: (input: string) => void): this;
    
    /**
     * Event: close.
     */
    on(event: 'close', listener: () => void): this;
    
    /**
     * Event: pause.
     */
    on(event: 'pause', listener: () => void): this;
    
    /**
     * Event: resume.
     */
    on(event: 'resume', listener: () => void): this;
    
    /**
     * Event: SIGCONT.
     */
    on(event: 'SIGCONT', listener: () => void): this;
  }
  
  interface CompleterResult extends Array<string | string[]> {
    /**
     * Is a completer result?
     */
    completer: true;
  }
  
  interface Completer {
    /**
     * Completes line.
     */
    (line: string): CompleterResult | Promise<CompleterResult>;
  }
}

// Add Module and Require types
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
     * Module loaded.
     */
    loaded: boolean;
    
    /**
     * Module children.
     */
    children: Module[];
    
    /**
     * Module parent.
     */
    parent: Module | null;
    
    /**
     * Module paths.
     */
    paths: string[];
    
    /**
     * Require function.
     */
    require(id: string): any;
    
    /**
     * Finds package.json.
     */
    findPackageJSON(request: string): string | null;
  }
}

// Add Process types
declare namespace NodeJS {
  interface Process extends EventEmitter {
    /**
     * Process ID.
     */
    readonly pid: number;
    
    /**
     * Platform.
     */
    readonly platform: string;
    
    /**
     * Architecture.
     */
    readonly arch: string;
    
    /**
     * Node version.
     */
    readonly version: string;
    
    /**
     * Versions.
     */
    readonly versions: Record<string, string>;
    
    /**
     * Release.
     */
    readonly release: Record<string, string>;
    
    /**
     * Environment.
     */
    readonly env: ProcessEnv;
    
    /**
     * Exec arguments.
     */
    readonly execArgv: string[];
    
    /**
     * Exec path.
     */
    readonly execPath: string;
    
    /**
     * Title.
     */
    title: string;
    
    /**
     * Abort controller.
     */
    readonly abortController: AbortController;
    
    /**
     * Features.
     */
    readonly features: Record<string, boolean>;
    
    /**
     * Main module.
     */
    readonly mainModule?: Module;
    
    /**
     * Standard input.
     */
    readonly stdin: ReadStream;
    
    /**
     * Standard output.
     */
    readonly stdout: WriteStream;
    
    /**
     * Standard error.
     */
    readonly stderr: WriteStream;
    
    /**
     * Connected.
     */
    readonly connected: boolean;
    
    /**
     * Exits process.
     */
    exit(code?: number): never;
    
    /**
     * Sends signal.
     */
    kill(pid: number, signal?: string | number): void;
    
    /**
     * CWD.
     */
    cwd(): string;
    
    /**
     * Changes CWD.
     */
    chdir(directory: string): void;
    
    /**
     * Umask.
     */
    umask(mask?: number): number;
    
    /**
     * Gets uptime.
     */
    uptime(): number;
    
    /**
     * Gets memory usage.
     */
    memoryUsage(): MemoryUsage;
    
    /**
     * Gets CPU usage.
     */
    cpuUsage(previousValue?: CpuUsage): CpuUsage;
    
    /**
     * Next tick.
     */
    nextTick(callback: Function, ...args: any[]): void;
    
    /**
     * HR time.
     */
    hrtime(time?: [number, number]): [number, number];
    
    /**
     * Dlopen.
     */
    dlopen(module: string): any;
    
    /**
     * Uptime in seconds.
     */
    uptimeS(): number;
    
    /**
     * Gets resource usage.
     */
    resourceUsage(): ResourceUsage;
    
    /**
     * Binding.
     */
    binding(binding: string): any;
  }
  
  interface MemoryUsage {
    /**
     * RSS in bytes.
     */
    rss: number;
    
    /**
     * Heap total.
     */
    heapTotal: number;
    
    /**
     * Heap used.
     */
    heapUsed: number;
    
    /**
     * External.
     */
    external: number;
    
    /**
     * Array buffers.
     */
    arrayBuffers: number;
  }
  
  interface CpuUsage {
    /**
     * User CPU time.
     */
    user: number;
    
    /**
     * System CPU time.
     */
    system: number;
  }
  
  interface ResourceUsage {
    /**
     * User time.
     */
    userCPUTime: number;
    
    /**
     * System time.
     */
    systemCPUTime: number;
    
    /**
     * Max RSS.
     */
    maxRSS: number;
    
    /**
     * Shared memory size.
     */
    sharedMemorySize: number;
  }
}

// Add Global types
declare namespace NodeJS {
  interface Global {
    /**
     * Global object.
     */
    global: Global;
    
    /**
     * Console.
     */
    console: typeof console;
    
    /**
     * Process.
     */
    process: Process;
    
    /**
     * Buffer.
     */
    Buffer: {
      new(size: number): Buffer;
      from(str: string, encoding?: BufferEncoding): Buffer;
      alloc(size: number, fill?: string | Buffer | number): Buffer;
      allocUnsafe(size: number): Buffer;
      isBuffer(obj: any): obj is Buffer;
      byteLength(str: string, encoding?: BufferEncoding): number;
      concat(list: Buffer[] | Buffer[][], totalLength?: number): Buffer;
    };
    
    /**
     * setTimeout.
     */
    setTimeout(callback: Function, delay: number, ...args: any[]): NodeJS.Timeout;
    
    /**
     * clearTimeout.
     */
    clearTimeout(timeoutId: NodeJS.Timeout): void;
    
    /**
     * setInterval.
     */
    setInterval(callback: Function, delay: number, ...args: any[]): NodeJS.Timeout;
    
    /**
     * clearInterval.
     */
    clearInterval(intervalId: NodeJS.Timeout): void;
    
    /**
     * setImmediate.
     */
    setImmediate(callback: Function, ...args: any[]): NodeJS.Immediate;
    
    /**
     * clearImmediate.
     */
    clearImmediate(immediateId: NodeJS.Immediate): void;
    
    /**
     * queueMicrotask.
     */
    queueMicrotask(callback: Function): void;
    
    /**
     * fetch.
     */
    fetch(input: string | URL, init?: RequestInit): Promise<Response>;
  }
}

// Add Assert types
declare namespace NodeJS {
  interface AssertionError extends Error {
    /**
     * Expected value.
     */
    expected: any;
    
    /**
     * Actual value.
     */
    actual: any;
    
    /**
     * Operator.
     */
    operator: string;
    
    /**
     * Generated message.
     */
    generatedMessage: string;
  }
  
  interface Assert {
    /**
     * Asserts value is truthy.
     */
    (value: any, message?: string | Error): asserts value;
    
    /**
     * Asserts deep equality.
     */
    deepStrictEqual(actual: any, expected: any, message?: string | Error): void;
    
    /**
     * Asserts not deep equality.
     */
    notDeepStrictEqual(actual: any, expected: any, message?: string | Error): void;
    
    /**
     * Asserts strict equality.
     */
    strictEqual(actual: any, expected: any, message?: string | Error): void;
    
    /**
     * Asserts not strict equality.
     */
    notStrictEqual(actual: any, expected: any, message?: string | Error): void;
    
    /**
     * Asserts throws.
     */
    throws(block: Function, error?: Function | Error | RegExp, message?: string | Error): void;
    
    /**
     * Asserts rejects.
     */
    rejects(block: Function | Promise<any>, error?: Function | Error | RegExp, message?: string | Error): Promise<void>;
    
    /**
     * Asserts fails.
     */
    fail(message?: string | Error): void;
    
    /**
     * Asserts match.
     */
    match(value: string, regexp: RegExp, message?: string | Error): void;
    
    /**
     * Asserts not match.
     */
    doesNotMatch(value: string, regexp: RegExp, message?: string | Error): void;
  }
}

// Add Path types
declare namespace NodeJS {
  interface Path {
    /**
     * Separator.
     */
    readonly sep: string;
    
    /**
     * Delimiter.
     */
    readonly delimiter: string;
    
    /**
     * Normalize path.
     */
    normalize(path: string): string;
    
    /**
     * Join paths.
     */
    join(...paths: string[]): string;
    
    /**
     * Resolve path.
     */
    resolve(...paths: string[]): string;
    
    /**
     * Is absolute?
     */
    isAbsolute(path: string): boolean;
    
    /**
     * Get dirname.
     */
    dirname(path: string): string;
    
    /**
     * Get basename.
     */
    basename(path: string, ext?: string): string;
    
    /**
     * Get extname.
     */
    extname(path: string): string;
    
    /**
     * Parse path.
     */
    parse(path: string): ParsedPath;
    
    /**
     * Format path.
     */
    format(pathObject: ParsedPath): string;
    
    /**
     * Get relative path.
     */
    relative(from: string, to: string): string;
    
    /**
     * Get directory names.
     */
    dirname(path: string): string;
  }
  
  interface ParsedPath {
    /**
     * Root.
     */
    root: string;
    
    /**
     * Directory.
     */
    dir: string;
    
    /**
     * Base.
     */
    base: string;
    
    /**
     * Ext.
     */
    ext: string;
    
    /**
     * Name.
     */
    name: string;
  }
}

// Add URL types
declare namespace NodeJS {
  interface URL extends URL {
    /**
     * Path.
     */
    path: string;
  }
  
  interface Url {
    /**
     * Protocol.
     */
    protocol: string;
    
    /**
     * Slashes.
     */
    slashes: boolean | null;
    
    /**
     * Auth.
     */
    auth: string | null;
    
    /**
     * Host.
     */
    host: string | null;
    
    /**
     * Port.
     */
    port: string | null;
    
    /**
     * Hostname.
     */
    hostname: string | null;
    
    /**
     * Hash.
     */
    hash: string | null;
    
    /**
     * Search.
     */
    search: string | null;
    
    /**
     * Query.
     */
    query: string | null;
    
    /**
     * Pathname.
     */
    pathname: string | null;
    
    /**
     * Path.
     */
    path: string | null;
    
    /**
     * Href.
     */
    href: string | null;
  }
  
  interface URLFormatException extends Error {
    /**
     * Input.
     */
    input: string;
  }
}

// Add String Decoder types
declare namespace NodeJS {
  interface StringDecoder {
    /**
     * Decodes buffer.
     */
    write(buffer: Buffer): string;
    
    /**
     * Ends decoding.
     */
    end(buffer?: Buffer): string;
    
    /**
     * Text encoding.
     */
    readonly text: string;
  }
  
  interface StringDecoderConstructor {
    /**
     * Creates decoder.
     */
    new(encoding?: BufferEncoding, defaultEncoding?: string): StringDecoder;
  }
}

// Add Stopwatch and TTY types
declare namespace NodeJS {
  interface Stopwatch {
    /**
     * Starts timer.
     */
    start(): void;
    
    /**
     * Stops timer.
     */
    stop(): void;
    
    /**
     * Resets timer.
     */
    reset(): void;
    
    /**
     * Gets elapsed time.
     */
    elapsed(): number;
  }
  
  interface TTY {
    /**
     * Is TTY?
     */
    isatty(fd: number): boolean;
    
    /**
     * Sets raw mode.
     */
    setRawMode(fd: number, mode: boolean): void;
  }
}

// Add Cipher and Decipher types
declare namespace NodeJS {
  interface Cipher extends NodeJS.ReadableStream, NodeJS.WritableStream {
    /**
     * Updates cipher.
     */
    update(data: Buffer | string, inputEncoding?: BufferEncoding, outputEncoding?: BufferEncoding): this;
    
    /**
     * Finalizes cipher.
     */
    final(outputEncoding?: BufferEncoding): Buffer;
    
    /**
     * Sets auth tag.
     */
    setAuthTag(tag: Buffer, encoding?: BufferEncoding): void;
    
    /**
     * Sets auto padding.
     */
    setAutoPadding(autoPadding: boolean): void;
    
    /**
     * Gets IV.
     */
    getIV(): Buffer;
    
    /**
     * Gets auth tag.
     */
    getAuthTag(): Buffer;
  }
  
  interface Decipher extends NodeJS.ReadableStream, NodeJS.WritableStream {
    /**
     * Updates decipher.
     */
    update(data: Buffer | string, inputEncoding?: BufferEncoding, outputEncoding?: BufferEncoding): this;
    
    /**
     * Finalizes decipher.
     */
    final(outputEncoding?: BufferEncoding): Buffer;
    
    /**
     * Sets auth tag.
     */
    setAuthTag(tag: Buffer, encoding?: BufferEncoding): void;
    
    /**
     * Sets auto padding.
     */
    setAutoPadding(autoPadding: boolean): void;
  }
  
  interface CipherCCM extends Cipher {
    /**
     * Sets IV.
     */
    setIV(iv: Buffer): void;
    
    /**
     * Sets nonce.
     */
    setNonce(nonce: Buffer): void;
    
    /**
     * Sets plaintext length.
     */
    setPlaintextLength(length: number): void;
    /**
     * Gets auth tag.
     */
    getAuthTag(): Buffer;
  }
  
  interface DecipherCCM extends Decipher {
    /**
     * Sets IV.
     */
    setIV(iv: Buffer): void;
    
    /**
     * Sets nonce.
     */
    setNonce(nonce: Buffer): void;
    
    /**
     * Sets auth tag.
     */
    setAuthTag(tag: Buffer, encoding?: BufferEncoding): void;
    
    /**
     * Sets plaintext length.
     */
    setPlaintextLength(length: number): void;
  }
}

// Add DNS types
declare namespace NodeJS {
  interface LookupAddress {
    /**
     * IP address.
     */
    address: string;
    
    /**
     * Address family.
     */
    family: 'IPv4' | 'IPv6';
  }
  
  interface LookupOptions {
    /**
     * Family.
     */
    family?: number | string;
    
    /**
     * Hints.
     */
    hints?: number;
    
    /**
     * All addresses?
     */
    all?: boolean;
    
    /**
     * Verbatim?
     */
    verbatim?: boolean;
    
    /**
     * DNS order.
     */
    dnsOrder?: string;
  }
  
  interface LookupOneOptions extends LookupOptions {
    /**
     * Not all addresses.
     */
    all?: false;
  }
  
  interface LookupAllOptions extends LookupOptions {
    /**
     * All addresses.
     */
    all: true;
  }
  
  interface Resolver extends EventEmitter {
    /**
     * Resolves hostname.
     */
    resolve(hostname: string, rrtype: string, callback?: (err: Error | null, addresses: string[]) => void): void;
    
    /**
     * Resolves A records.
     */
    resolve4(hostname: string, callback?: (err: Error | null, addresses: string[]) => void): void;
    
    /**
     * Resolves AAAA records.
     */
    resolve6(hostname: string, callback?: (err: Error | null, addresses: string[]) => void): void;
    
    /**
     * Resolves CNAME records.
     */
    resolveCname(hostname: string, callback?: (err: Error | null, addresses: string[]) => void);
    
    /**
     * Resolves MX records.
     */
    resolveMx(hostname: string, callback?: (err: Error | null, addresses: string[]) => void);
    
    /**
     * Resolves NS records.
     */
    resolveNs(hostname: string, callback?: (err: Error | null, addresses: string[]) => void);
    
    /**
     * Resolves TXT records.
     */
    resolveTxt(hostname: string, callback?: (err: Error | null, addresses: string[][]) => void);
    
    /**
     * Resolves SRV records.
     */
    resolveSrv(hostname: string, callback?: (err: Error | null, records: DnsSrvRecord[]) => void);
    
    /**
     * Reverses address.
     */
    reverse(ip: string, callback?: (err: Error | null, hostnames: string[]) => void);
  }
  
  interface DnsSrvRecord {
    /**
     * Priority.
     */
    priority: number;
    
    /**
     * Weight.
     */
    weight: number;
    
    /**
     * Port.
     */
    port: number;
    
    /**
     * Target.
     */
    target: string;
  }
}

// Add Net Server types
declare namespace NodeJS {
  interface Server extends Socket {
    /**
     * Server listening?
     */
    readonly listening: boolean;
    
    /**
     * Server max connections.
     */
    maxConnections: number;
    
    /**
     * Server connections count.
     */
    connections: number;
    
    /**
     * Server timeout.
     */
    timeout: number;
    
    /**
     * Server keep alive timeout.
     */
    keepAliveTimeout: number;
    
    /**
     * Server headers timeout.
     */
    headersTimeout: number;
    
    /**
     * Listens on port.
     */
    listen(port?: number, hostname?: string, backlog?: number, callback?: Function): this;
    
    /**
     * Closes server.
     */
    close(callback?: Function): this;
    
    /**
     * Refs server.
     */
    ref(): this;
    
    /**
     * Unrefs server.
     */
    unref(): this;
    
    /**
     * Event: connection.
     */
    on(event: 'connection', listener: (socket: Socket) => void): this;
    
    /**
     * Event: listening.
     */
    on(event: 'listening', listener: () => void): this;
    
    /**
     * Event: close.
     */
    on(event: 'close', listener: () => void): this;
    
    /**
     * Event: error.
     */
    on(event: 'error', listener: (err: Error) => void): this;
  }
}

// Add HTTP/2 types
declare namespace NodeJS {
  interface Http2Session extends EventEmitter {
    /**
     * Session destroyed?
     */
    readonly destroyed: boolean;
    
    /**
     * Session local settings.
     */
    readonly localSettings: Settings;
    
    /**
     * Session remote settings.
     */
    readonly remoteSettings: Settings;
    
    /**
     * Session socket.
     */
    readonly socket: Socket;
    
    /**
     * Session origin.
     */
    readonly origin: string;
    
    /**
     * Session state.
     */
    readonly state: number;
    
    /**
     * Session streams.
     */
    readonly stream: Stream;
    
    /**
     * Closes session.
     */
    close(callback?: Function): void;
    
    /**
     * Destroys session.
     */
    destroy(error?: Error, callback?: Function): void;
    
    /**
     * Goaways session.
     */
    goaway(code?: number, lastStreamID?: number, opaqueData?: Buffer): void;
    
    /**
     * Pings session.
     */
    ping(callback?: Function): void;
    
    /**
     * Sets timeout.
     */
    setTimeout(msecs: number, callback?: Function): this;
    
    /**
     * Event: close.
     */
    on(event: 'close', listener: () => void): this;
    
    /**
     * Event: error.
     */
    on(event: 'error', listener: (err: Error) => void): this;
    
    /**
     * Event: frame error.
     */
    on(event: 'frameError', listener: (frameType: number, errorCode: number, streamID: number) => void): this;
    
    /**
     * Event: goaway.
     */
    on(event: 'goaway', listener: (errorCode: number, lastStreamID: number, opaqueData: Buffer) => void): this;
    
    /**
     * Event: local settings.
     */
    on(event: 'localSettings', listener: (settings: Settings) => void): this;
    
    /**
     * Event: remote settings.
     */
    on(event: 'remoteSettings', listener: (settings: Settings) => void): this;
  }
  
  interface Settings {
    /**
     * Header table size.
     */
    headerTableSize?: number;
    
    /**
     * Enable push?
     */
    enablePush?: boolean;
    
    /**
     * Initial window size.
     */
    initialWindowSize?: number;
    
    /**
     * Max frame size.
     */
    maxFrameSize?: number;
    
    /**
     * Max concurrent streams.
     */
    maxConcurrentStreams?: number;
    
    /**
     * Max header list size.
     */
    maxHeaderListSize?: number;
    
    /**
     * Enable push?
     */
    enableConnectProtocol?: boolean;
    
    /**
     * Max header size.
     */
    maxHeaderSize?: number;
  }
}

// Add HTTP/2 Stream types
declare namespace NodeJS {
  interface ClientHttp2Session extends Http2Session {
    /**
     * Requests new stream.
     */
    request(headers?: Headers, options?: StreamPriorityOptions): ClientHttp2Stream;
    
    /**
     * Connects to host.
     */
    connect(authority: string | URL, listener?: (session: ClientHttp2Session, socket: Socket) => void);
  }
  
  interface ServerHttp2Session extends Http2Session {
    /**
     * Server type.
     */
    readonly server: Http2Server;
    
    /**
     * Spawned session.
     */
    readonly socket: Socket;
  }
  
  interface Http2Stream extends EventEmitter {
    /**
     * Stream ID.
     */
    readonly id: number;
    
    /**
     * Session.
     */
    readonly session: Http2Session;
    
    /**
     * Stream destroyed?
     */
    readonly destroyed: boolean;
    
    /**
     * Stream state.
     */
    readonly state: number;
    
    /**
     * Stream headers.
     */
    readonly headers: Headers;
    
    /**
     * Sends headers.
     */
    respond(headers?: Headers): void;
    
    /**
     * Closes stream.
     */
    close(callback?: Function): void;
    
    /**
     * Destroys stream.
     */
    destroy(error?: Error, callback?: Function): void;
    
    /**
     * Gets priority.
     */
    priority(): StreamPriority;
    
    /**
     * Sets priority.
     */
    setPriority(priority: StreamPriority): void;
    
    /**
     * Sends data.
     */
    write(chunk: Buffer | string): boolean;
    
    /**
     * Ends stream.
     */
    end(callback?: Function): void;
    
    /**
     * Event: data.
     */
    on(event: 'data', listener: (chunk: Buffer) => void): this;
    
    /**
     * Event: finish.
     */
    on(event: 'finish', listener: () => void): this;
    
    /**
     * Event: close.
     */
    on(event: 'close', listener: () => void): this;
    
    /**
     * Event: error.
     */
    on(event: 'error', listener: (err: Error) => void): this;
  }
  
  interface ClientHttp2Stream extends Http2Stream {
    /**
     * ClientHttp2Stream.
     */
  }
  
  interface ServerHttp2Stream extends Http2Stream {
    /**
     * ServerHttp2Stream.
     */
  }
  
  interface StreamPriority {
    /**
     * Stream weight.
     */
    weight?: number;
    
    /**
     * Stream dependency.
     */
    parent?: number;
    
    /**
     * Stream exclusive.
     */
    exclusive?: boolean;
  }
  
  interface StreamPriorityOptions extends StreamPriority {
    /**
     * Stream silent.
     */
    silent?: boolean;
  }
}

// Add HTTP/2 Server types
declare namespace NodeJS {
  interface Http2Server extends EventEmitter {
    /**
     * Server session.
     */
    readonly session: ServerHttp2Session;
    
    /**
     * Server socket.
     */
    readonly socket: Socket;
    
    /**
     * Server timeout.
     */
    timeout: number;
    
    /**
     * Server max session memory.
     */
    maxSessionMemory: number;
    
    /**
     * Max session invalid.
     */
    maxSessionInvalid?: number;
    
    /**
     * Max settings count.
     */
    maxSettingsCount?: number;
    
    /**
     * Creates server.
     */
    static create(options?: ServerOptions): Http2Server;
    
    /**
     * Creates secure server.
     */
    static createSecureServer(options?: SecureServerOptions): Http2SecureServer;
  }
  
  interface Http2SecureServer extends Http2Server {
    /**
     * Secure server.
     */
    readonly server: Server;
  }
  
  interface ServerOptions {
    /**
     * Max concurrent streams.
     */
    maxConcurrentStreams?: number;
    
    /**
     * Max header table size.
     */
    maxHeaderTableSize?: number;
    
    /**
     * Max header size.
     */
    maxHeaderSize?: number;
    
    /**
     * Max settings count.
     */
    maxSettingsCount?: number;
    
    /**
     * Max session memory.
     */
    maxSessionMemory?: number;
    
    /**
     * Stream timeout.
     */
    streamTimeout?: number;
  }
  
  interface SecureServerOptions extends ServerOptions {
    /**
     * Private key.
     */
    key: string | Buffer | Array<string | Buffer>;
    
    /**
     * Certificate.
     */
    cert: string | Buffer | Array<string | Buffer>;
    
    /**
     * CA certificates.
     */
    ca?: string | Buffer | Array<string | Buffer>;
    
    /**
     * Passphrase.
     */
    passphrase?: string;
    
    /**
     * Reject unauthorized.
     */
    rejectUnauthorized?: boolean;
    
    /**
     * Servername.
     */
    servername?: string;
  }
}

// Add V8 types
declare namespace NodeJS {
  interface HeapInfo {
    /**
     * Total heap size.
     */
    total_heap_size: number;
    
    /**
     * Total heap size limit.
     */
    total_heap_size_limit: number;
    
    /**
     * Total available size.
     */
    total_available_size: number;
    
    /**
     * Used heap size.
     */
    used_heap_size: number;
    
    /**
     * Heap size limit.
     */
    heap_size_limit: number;
    
    /**
     * Malloced memory.
     */
    mallocated_memory: number;
    
    /**
     * Peak malloced memory.
     */
    peak_malloced_memory: number;
    
    /**
     * Does zapping garbage?
     */
    does_zap_garbage: number;
    
    /**
     * Number of native contexts.
     */
    number_of_native_contexts: number;
    
    /**
     * Number of detached contexts.
     */
    number_of_detached_contexts: number;
  }
  
  interface V8 {
    /**
     * Gets heap statistics.
     */
    getHeapStatistics(): HeapInfo;
    
    /**
     * Gets heap snapshot.
     */
    getHeapSnapshot(): string;
    
    /**
     * Writes heap snapshot.
     */
    writeHeapSnapshot(filename: string): void;
    
    /**
     * Gets heap code statistics.
     */
    getHeapCodeStatistics(): HeapCodeStatistics;
    
    /**
     * Gets heap space statistics.
     */
    getHeapSpaceStatistics(): HeapSpaceStatistics[];
    
    /**
     * Sets flags.
     */
    setFlags(flags: string): void;
    
    /**
     * Takes heap snapshot.
     */
    takeCoverage(): void;
    
    /**
     * Stops coverage.
     */
    stopCoverage(): void;
  }
  
  interface HeapCodeStatistics {
    /**
     * Code statistics.
     */
    code_and_metadata_size: number;
    
    /**
     * Bytecode and metadata size.
     */
    bytecode_and_metadata_size: number;
    
    /**
     * External script source size.
     */
    external_script_source_size: number;
  }
  
  interface HeapSpaceStatistics {
    /**
     * Space name.
     */
    space_name: string;
    
    /**
     * Space size.
     */
    space_size: number;
    
    /**
     * Space used size.
     */
    space_used_size: number;
    
    /**
     * Space available size.
     */
    space_available_size: number;
    
    /**
     * Physical space size.
     */
    physical_space_size: number;
  }
}

// Add VM Script types
declare namespace NodeJS {
  interface Script extends Context {
    /**
     * Cached data.
     */
    cachedData?: Buffer;
    
    /**
     * Cached data produced.
     */
    cachedDataProduced?: Buffer;
    
    /**
     * Script source.
     */
    readonly source: string;
    
    /**
     * Script filename.
     */
    readonly filename: string;
    
    /**
     * Runs script.
     */
    runInContext(contextifiedSandbox: object, options?: RunningCodeOptions): any;
    
    /**
     * Runs in new context.
     */
    runInNewContext(sandbox?: object, options?: RunningCodeOptions): any;
    
    /**
     * Compiles code.
     */
    compileCodeInContext(code: string, contextifiedSandbox: object, options?: CompilationOptions): Function;
  }
  
  interface Context extends EventEmitter {
    /**
     * Sandbox object.
     */
    readonly sandbox: Record<string, any>;
    
    /**
     * Context script.
     */
    readonly script: Script | null;
    
    /**
     * Compiles function.
     */
    compileFunction(code: string, params?: string[], options?: CompilationOptions): Function;
    
    /**
     * Runs code.
     */
    run(code: string, options?: RunningCodeOptions): any;
    
    /**
     * Gets context.
     */
    get(context: object, key: string): any;
    
    /**
     * Sets context.
     */
    set(context: object, key: string, value: any): boolean;
  }
  
  interface RunningCodeOptions {
    /**
     * Filename.
     */
    filename?: string;
    
    /**
     * Line offset.
     */
    lineOffset?: number;
    
    /**
     * Column offset.
     */
    columnOffset?: number;
    
    /**
     * Display errors.
     */
    displayErrors?: boolean;
    
    /**
     * Timeout.
     */
    timeout?: number;
    
    /**
     * Break on signal.
     */
    breakOnSigint?: boolean;
  }
  
  interface CompilationOptions {
    /**
     * Filename.
     */
    filename?: string;
    
    /**
     * Line offset.
     */
    lineOffset?: number;
    
    /**
     * Column offset.
     */
    columnOffset?: number;
    
    /**
     * Cached data.
     */
    cachedData?: Buffer;
    
    /**
     * Produce cached data.
     */
    produceCachedData?: boolean;
  }
}

// Add Worker threads Communication types
declare namespace NodeJS {
  interface MessagePort extends EventEmitter {
    /**
     * Sends message.
     */
    postMessage(value: any, transferList?: any[]): void;
    
    /**
     * Closes port.
     */
    close(): void;
    
    /**
     * Refs port.
     */
    ref(): void;
    
    /**
     * Unrefs port.
     */
    unref(): void;
    
    /**
     * Starts port.
     */
    start(): void;
    
    /**
     * Event: message.
     */
    on(event: 'message', listener: (value: any) => void): this;
    
    /**
     * Event: close.
     */
    on(event: 'close', listener: () => void): this;
    
    /**
     * Event: messageerror.
     */
    on(event: 'messageerror', listener: (error: Error) => void): this;
  }
  
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
}

// Add Performance API types
declare namespace NodeJS {
  interface Performance extends EventEmitter {
    /**
     * Gets current time.
     */
    now(): number;
    
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
     * Gets marks.
     */
    getEntries(): PerformanceEntry[];
    
    /**
     * Gets entries by type.
     */
    getEntriesByType(type: string): PerformanceEntry[];
    
    /**
     * Gets entries by name.
     */
    getEntriesByName(name: string, type?: string): PerformanceEntry[];
    
    /**
     * Marks performance.
     */
    mark(name: string): void;
    
    /**
     * Measures performance.
     */
    measure(name: string, startMark?: string, endMark?: string): void;
    
    /**
     * Event loop timing.
     */
    eventLoopUtilization(): Utilization;
    
    /**
     * Event loop timing detail.
     */
    eventLoopUtilizationRaw(): NodeJS.EventLoopUtilization;
    
    /**
     * Timerify.
     */
    timerify<T extends Function>(fn: T): T;
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
    
    /**
     * Detail.
     */
    detail?: any;
  }
  
  interface PerformanceMark extends PerformanceEntry {
    /**
     * Entry type is mark.
     */
    entryType: 'mark';
  }
  
  interface PerformanceMeasure extends PerformanceEntry {
    /**
     * Entry type is measure.
     */
    entryType: 'measure';
    
    /**
     * Start mark.
     */
    start: string;
    
    /**
     * End mark.
     */
    end: string;
  }
  
  interface Utilization {
    /**
     * Active utilization.
     */
    active: number;
    
    /**
     * Idle utilization.
     */
    idle: number;
    
    /**
     * Utilization.
     */
    utilization: number;
  }
  
  interface EventLoopUtilization extends Utilization {
    /**
     * Utilization in idle.
     */
    utilization: number;
    
    /**
     * Active utilization.
     */
    active: number;
    
    /**
     * Idle utilization.
     */
    idle: number;
  }
}

// Add Timers types
declare namespace NodeJS {
  interface Timeout extends Timer {
    /**
     * Refreshest timer.
     */
    refresh(): this;
    
    /**
     * Has ref?
     */
    hasRef(): boolean;
    
    /**
     * Refs timer.
     */
    ref(): this;
    
    /**
     * Unrefs timer.
     */
    unref(): this;
    
    /**
     * Throws if active.
     */
    throwOnError(): void;
    
    /**
     * Clears timeout.
     */
    [Symbol.dispose](): void;
    
    /**
     * Timeout number.
     */
    readonly [Symbol.toPrimitive](): number;
  }
  
  interface Immediate extends Timer {
    /**
     * Has ref?
     */
    hasRef(): boolean;
    
    /**
     * Refs immediate.
     */
    ref(): this;
    
    /**
     * Unrefs immediate.
     */
    unref(): this;
    
    /**
     * Immediate callback.
     */
    readonly _onImmediate: Function;
  }
}

// Add File System Stats types
declare namespace NodeJS {
  interface StatsBase<T> {
    /**
     * Is directory?
     */
    isDirectory(): this is T;
    
    /**
     * Is file?
     */
    isFile(): this is T;
    
    /**
     * Is block device?
     */
    isBlockDevice(): this is T;
    
    /**
     * Is character device?
     */
    isCharacterDevice(): this is T;
    
    /**
     * Is symbolic link?
     */
    isSymbolicLink(): this is T;
    
    /**
     * Is FIFO?
     */
    isFIFO(): this is T;
    
    /**
     * Is socket?
     */
    isSocket(): this is T;
  }
  
  interface Stats extends StatsBase<BigInt> {
    /**
     * Device ID.
     */
    dev: number;
    
    /**
     * Inode.
     */
    ino: number;
    
    /**
     * Mode.
     */
    mode: number;
    
    /**
     * Nlink.
     */
    nlink: number;
    
    /**
     * UID.
     */
    uid: number;
    
    /**
     * GID.
     */
    gid: number;
    
    /**
     * Rdev.
     */
    rdev: number;
    
    /**
     * Size.
     */
    size: number;
    
    /**
     * Blksize.
     */
    blksize: number;
    
    /**
     * Blocks.
     */
    blocks: number;
    
    /**
     * Atime.
     */
    atimeMs: number;
    
    /**
     * Mtime.
     */
    mtimeMs: number;
    
    /**
     * Ctime.
     */
    ctimeMs: number;
    
    /**
     * Birthtime.
     */
    birthtimeMs: number;
    
    /**
     * Atime.
     */
    atime: Date;
    
    /**
     * Mtime.
     */
    mtime: Date;
    
    /**
     * Ctime.
     */
    ctime: Date;
    
    /**
     * Birthtime.
     */
    birthtime: Date;
  }
  
  interface BigIntStats extends StatsBase<BigInt> {
    /**
     * Dev.
     */
    dev: bigint;
    
    /**
     * Ino.
     */
    ino: bigint;
    
    /**
     * Mode.
     */
    mode: bigint;
    
    /**
     * Nlink.
     */
    nlink: bigint;
    
    /**
     * UID.
     */
    uid: bigint;
    
    /**
     * GID.
     */
    gid: bigint;
    
    /**
     * Rdev.
     */
    rdev: bigint;
    
    /**
     * Size.
     */
    size: bigint;
    
    /**
     * Blksize.
     */
    blksize: bigint;
    
    /**
     * Blocks.
     */
    blocks: bigint;
    
    /**
     * AtimeMs.
     */
    atimeMs: bigint;
    
    /**
     * MtimeMs.
     */
    mtimeMs: bigint;
    
    /**
     * CtimeMs.
     */
    ctimeMs: bigint;
    
    /**
     * BirthtimeMs.
     */
    birthtimeMs: bigint;
  }
}

// Add Crypto constants types
declare namespace NodeJS {
  interface CryptoConstants {
    /**
     * OpenSSL options.
     */
    OPENSSL_VERSION_NUMBER: number;
    
    /**
     * SSL_OP_NO_SSLv2.
     */
    SSL_OP_NO_SSLv2: number;
    
    /**
     * SSL_OP_NO_SSLv3.
     */
    SSL_OP_NO_SSLv3: number;
    
    /**
     * SSL_OP_NO_TLSv1.
     */
    SSL_OP_NO_TLSv1: number;
    
    /**
     * SSL_OP_NO_TLSv1_1.
     */
    SSL_OP_NO_TLSv1_1: number;
    
    /**
     * SSL_OP_NO_TLSv1_2.
     */
    SSL_OP_NO_TLSv1_2: number;
    
    /**
     * SSL_OP_NO_TLSv1_3.
     */
    SSL_OP_NO_TLSv1_3: number;
    
    /**
     * ENGINE_METHOD_RSA.
     */
    ENGINE_METHOD_RSA: string;
    
    /**
     * ENGINE_METHOD_DSA.
     */
    ENGINE_METHOD_DSA: string;
    
    /**
     * ENGINE_METHOD_DH.
     */
    ENGINE_METHOD_DH: string;
    
    /**
     * ENGINE_METHOD_RAND.
     */
    ENGINE_METHOD_RAND: string;
    
    /**
     * ENGINE_METHOD_EC.
     */
    ENGINE_METHOD_EC: string;
    
    /**
     * ENGINE_METHOD_CIPHERS.
     */
    ENGINE_METHOD_CIPHERS: string;
    
    /**
     * ENGINE_METHOD_DIGESTS.
     */
    ENGINE_METHOD_DIGESTS: string;
    
    /**
     * ENGINE_METHOD_PKEY_METHS.
     */
    ENGINE_METHOD_PKEY_METHS: string;
    
    /**
     * ENGINE_METHOD_STORE.
     */
    ENGINE_METHOD_STORE: number;
    
    /**
     * ENGINE_METHOD_ALL.
     */
    ENGINE_METHOD_ALL: number;
    
    /**
     * DH_CHECK_PUBKEY.
     */
    DH_CHECK_PUBKEY_ALWAYS: number;
    
    /**
     * DH_CHECK_PUBKEY_NEVER.
     */
    DH_CHECK_PUBKEY_NEVER: number;
    
    /**
     * DH_CHECK_PUBKEY_SOMETIMES.
     */
    DH_CHECK_PUBKEY_SOMETIMES: number;
    
    /**
     * RSA_PKCS1_PADDING.
     */
    RSA_PKCS1_PADDING: number;
    
    /**
     * RSA_SSLV23_PADDING.
     */
    RSA_SSLV23_PADDING: number;
    
    /**
     * RSA_NO_PADDING.
     */
    RSA_NO_PADDING: number;
    
    /**
     * RSA_PKCS1_OAEP_PADDING.
     */
    RSA_PKCS1_OAEP_PADDING: number;
    
    /**
     * RSA_X931_PADDING.
     */
    RSA_X931_PADDING: number;
    
    /**
     * RSA_X509_PADDING.
     */
    RSA_X509_PADDING: number;
    
    /**
     * POINT_CONVERSION_COMPRESSED.
     */
    POINT_CONVERSION_COMPRESSED: number;
    
    /**
     * POINT_CONVERSION_UNCOMPRESSED.
     */
    POINT_CONVERSION_UNCOMPRESSED: number;
  }
}

// Add Exceptions types
declare namespace NodeJS {
  interface SystemError extends Error {
    /**
     * Error code.
     */
    code: string;
    
    /**
     * Error number.
     */
    errno: number;
    
    /**
     * System call.
     */
    syscall: string;
    
    /**
     * Path.
     */
    path?: string;
    
    /**
     * Destination path.
     */
    dest?: string;
  }
  
  interface ErrnoException extends SystemError {
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
  }
}

// Add Addons types
declare namespace NodeJS {
  interface Addon extends EventEmitter {
    /**
     * Addon path.
     */
    path: string;
    
    /**
     * Exports addon.
     */
    exports: any;
    
    /**
     * Loads addon.
     */
    load(callback?: Function): void;
    
    /**
     * Event: load.
     */
    on(event: 'load', listener: (addon: any) => void): this;
    
    /**
     * Event: error.
     */
    on(event: error, listener: (err: Error) => void): this;
  }
  
  interface AddonOptions {
    /**
     * Exports path.
     */
    exports?: Record<string, any>;
    
    /**
     * Global flag.
     */
    global?: boolean;
    
    /**
     * Root path.
     */
    root?: string;
    
    /**
     * Verbose?
     */
    verbose?: boolean;
    
    /**
     * NAPI version.
     */
    napiVersion?: number;
  }
}

// Adding Export and Import types
declare namespace NodeJS {
  interface ExportInfo {
    /**
     * Export name.
     */
    name: string;
    
    /**
     * Export kind.
     */
    kind: 'type' | 'const' | 'let' | 'var';
    
    /**
     * Export value.
     */
    value: any;
  }
  
  interface ImportAttributes {
    /**
     * Import type.
     */
    type?: string;
    
    /**
     * Import query.
     */
    query?: string;
    
    /**
     * Import fragment.
     */
    fragment?: string;
  }
}

// Add CLI options types
declare namespace NodeJS {
  interface ExecSyncOptions {
    /**
     * Encoding.
     */
    encoding?: BufferEncoding;
    
    /**
     * Timeout.
     */
    timeout?: number;
    
    /**
     * Max buffer.
     */
    maxBuffer?: number;
    
    /**
     * Windows hide.
     */
    windowsHide?: boolean;
  }
  
  interface ExecOptions extends ExecSyncOptions {
    /**
     * CWD.
     */
    cwd?: string;
    
    /**
     * Environment.
     */
    env?: Record<string, string>;
    
    /**
     * Shell.
     */
    shell?: string | boolean;
    
    /**
     * UID.
     */
    uid?: number;
    
    /**
     * GID.
     */
    gid?: number;
  }
  
  interface SpawnOptions extends ExecOptions {
    /**
     * Arguments.
     */
    args?: string[];
    
    /**
     * Detached.
     */
    detached?: boolean;
    
    /**
     * Stdio.
     */
    stdio?: Array<string | Stream | 'pipe' | 'inherit' | 'ignore' | number>;
    
    /**
     * Windows verbatim arguments.
     */
    windowsVerbatimArguments?: boolean;
    
    /**
     * Windows hide.
     */
    windowsHide?: boolean;
  }
}

//加添加中文注释示例类型
declare namespace Bun {
  /**
   * 中文示例类型
   * Chinese example types
   */
  interface 中文示例 {
    /**
     * 名称。
     */
    名称: string;
    
    /**
     * 年龄。
     */
    年龄: number;
    
    /**
     * 邮箱。
     */
    邮箱: string;
    
    /**
     * 获取信息。
     */
    获取信息(): string;
  }
}

// Add Stream result types
declare namespace NodeJS {
  interface StreamResult<T> {
    /**
     * Result data.
     */
    data: T;
    
    /**
     * Result bytes.
     */
    bytes: number;
    
    /**
     * Result done flag.
     */
    done: boolean;
    
    /**
     * Result error.
     */
    error?: Error;
  }
  
  interface ReadStreamOptions {
    /**
     * HighWaterMark.
     */
    highWaterMark?: number;
    
    /**
     * Encoding.
     */
    encoding?: BufferEncoding;
    
    /**
     * Object mode?
     */
    objectMode?: boolean;
    
    /**
     * Read start.
     */
    start?: number;
    
    /**
     * Read end.
     */
    end?: number;
  }
  
  interface WriteStreamOptions {
    /**
     * HighWaterMark.
     */
    highWaterMark?: number;
    
    /**
     * DecodeStrings.
     */
    decodeStrings?: boolean;
    
    /**
     * Default encoding.
     */
    defaultEncoding?: BufferEncoding;
    
    /**
     * Object mode?
     */
    objectMode?: boolean;
  }
}

// Add Process Signal types
declare namespace NodeJS {
  interface Signals {
    /**
     * Signals map.
     */
    readonly [signal: string]: number;
  }
  
  interface SignalConstants {
    /**
     * SIGHUP signal.
     */
    SIGHUP: number;
    
    /**
     * SIGINT signal.
     */
    SIGINT: number;
    
    /**
     * SIGQUIT signal.
     */
    SIGQUIT: number;
    
    /**
     * SIGILL signal.
     */
    SIGILL: number;
    
    /**
     * SIGTRAP signal.
     */
    SIGTRAP: number;
    
    /**
     * SIGABRT signal.
     */
    SIGABRT: number;
    
    /**
     * SIGBUS signal.
     */
    SIGBUS: number;
    
    /**
     * SIGFPE signal.
     */
    SIGFPE: number;
    
    /**
     * SIGKILL signal.
     */
    SIGKILL: number;
    
    /**
     * SIGUSR1 signal.
     */
    SIGUSR1: number;
    
    /**
     * SIGUSR2 signal.
     */
    SIGUSR2: number;
    
    /**
     * SIGSEGV signal.
     */
    SIGSEGV: number;
    
    /**
     * SIGTERM signal.
     */
    SIGTERM: number;
    
    /**
     * SIGCHLD signal.
     */
    SIGCHLD: number;
    
    /**
     * SIGSTOP signal.
     */
    SIGSTOP: number;
  }
}

// Add Buffer constants types
declare namespace NodeJS {
  interface BufferConstants {
    /**
     * Buffer constants.
     */
    readonly MAX_LENGTH: number;
    
    /**
     * Max string length.
     */
    readonly MAX_STRING_LENGTH: number;
    
    /**
     * Buffer pool size.
     */
    readonly BUFFER_POOL_SIZE: number;
  }
}

// readline module types
declare module "node:readline" {
  import { EventEmitter } from "node:events";
  
  export interface ReadLineOptions {
    input: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    completer?: Completer | AsyncCompleter;
    terminal?: boolean;
    history?: string[];
    historySize?: number;
    prompt?: string;
    crlfDelay?: number;
    removeHistoryDuplicates?: boolean;
    escapeCodeTimeout?: number;
  }
  
  export type Completer = (line: string) => [string[], string];
  export type AsyncCompleter = (line: string, callback: (err?: null | Error, result?: [string[], string]) => void) => void;
  
  export interface Key {
    sequence?: string;
    name?: string;
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
  }
  
  export class Interface extends EventEmitter {
    readonly terminal: boolean;
    prompt(): void;
    pause(): this;
    resume(): this;
    write(data: string | Buffer, key?: Key): void;
    question(query: string, callback: (answer: string) => void): void;
    close(): void;
    readonly line: string;
    readonly cursor: number;
  }
  
  export function createInterface(options: ReadLineOptions): Interface;
}

// querystring module types
declare module "node:querystring" {
  export interface StringifyOptions {
    encodeURIComponent?: (str: string) => string;
  }
  
  export interface ParseOptions {
    maxKeys?: number;
    decodeURIComponent?: (str: string) => string;
  }
  
  export function stringify(obj: Record<string, any>, options?: StringifyOptions): string;
  export function parse(str: string, options?: ParseOptions): Record<string, any>;
  export function escape(str: string): string;
  export function unescape(str: string): string;
}

// cluster module types
declare module "node:cluster" {
  import { EventEmitter } from "node:events";
  import { ChildProcess } from "node:child_process";
  
  export interface ClusterSettings {
    exec?: string;
    args?: string[];
    silent?: boolean;
    execArgv?: string[];
    cwd?: string;
    inspectPort?: number | (() => number);
  }
  
  export interface Worker extends ChildProcess {
    readonly id: number;
    readonly process: ChildProcess;
    send(message: any, sendHandle?: any, options?: any, callback?: (error: Error | null) => void): boolean;
    kill(signal?: string): void;
    disconnect(): void;
    isConnected(): boolean;
    isDead(): boolean;
    exitedAfterDisconnect: boolean;
  }
  
  export interface Cluster extends EventEmitter {
    readonly Worker: typeof Worker;
    readonly workers: Record<number, Worker>;
    readonly isMaster: boolean;
    readonly isWorker: boolean;
    readonly settings: ClusterSettings;
    readonly worker?: Worker;
    readonly id?: number;
    fork(env?: any): Worker;
    disconnect(callback?: () => void): void;
    setupMaster(settings?: ClusterSettings): void;
    schedulingPolicy: number;
    settings: ClusterSettings;
  }
  
  export const SCHED_NONE: number;
  export const SCHED_RR: number;
  
  const cluster: Cluster;
  export default cluster;
}

// dgram module types
declare module "node:dgram" {
  import { EventEmitter } from "node:events";
  import { AddressInfo } from "node:net";
  
  export interface RemoteInfo {
    address: string;
    family: "IPv4" | "IPv6";
    port: number;
    size: number;
  }
  
  export interface BindOptions {
    port?: number;
    address?: string;
    exclusive?: boolean;
    fd?: number;
  }
  
  export class Socket extends EventEmitter {
    readonly type: "udp4" | "udp6";
    send(
      msg: Buffer | string | Uint8Array,
      port: number,
      address?: string,
      callback?: (error: Error | null, bytes: number) => void
    ): void;
    send(
      msg: Buffer | string | Uint8Array,
      offset: number,
      length: number,
      port: number,
      address?: string,
      callback?: (error: Error | null, bytes: number) => void
    ): void;
    bind(port?: number, address?: string, callback?: () => void): this;
    bind(options: BindOptions, callback?: () => void): this;
    close(callback?: () => void): void;
    address(): AddressInfo | string;
    setBroadcast(flag: boolean): void;
    setTTL(ttl: number): void;
    setMulticastTTL(ttl: number): void;
    setMulticastInterface(multicastInterface: string): void;
    setMulticastLoopback(flag: boolean): void;
    addMembership(multicastAddress: string, multicastInterface?: string): void;
    dropMembership(multicastAddress: string, multicastInterface?: string): void;
    ref(): this;
    unref(): this;
  }
  
  export function createSocket(type: "udp4" | "udp6", callback?: (msg: Buffer, rinfo: RemoteInfo) => void): Socket;
}

// repl module types
declare module "node:repl" {
  import { Interface as ReadlineInterface } from "node:readline";
  import { Context } from "node:vm";
  import { EventEmitter } from "node:events";
  
  export interface REPLEval {
    (code: string, context: Context, filename: string, callback: (err: Error | null, result: any) => void): any;
  }
  
  export interface ReplOptions {
    prompt?: string;
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    terminal?: boolean;
    eval?: REPLEval;
    useColors?: boolean;
    useGlobal?: boolean;
    ignoreUndefined?: boolean;
    writer?: (obj: any) => string;
    completer?: any;
    replMode?: any;
    breakEvalOnSigint?: boolean;
    preview?: boolean;
  }
  
  export interface REPLServerAction {
    final: any;
    mid: any;
    err: any;
  }
  
  export interface REPLServer extends ReadlineInterface {
    context: Context;
    readonly input: NodeJS.ReadableStream;
    readonly output: NodeJS.WritableStream;
    readonly terminal: boolean;
    defineCommand(keyword: string, cmd: string | { help: string; action: (this: REPLServer) => void }): void;
    displayPrompt(preserveCursor?: boolean): void;
    clearBufferedCommand(): void;
    parseREPLKeyword(keyword: string, rest: string): REPLServerAction | void;
    setupHistory(path: string, callback: (err: Error | null, repl: this) => void): void;
  }
  
  export function start(options?: ReplOptions): REPLServer;
  export const REPL_MODE_SLOPPY: symbol;
  export const REPL_MODE_STRICT: symbol;
}

// tls module types


// net module additional types
declare module "node:net" {
  export interface SocketAddressOpts {
    host?: string;
    port?: number;
    flowlabel?: number;
  }
  
  export interface LookupFunction {
    (hostname: string, options: LookupAllOptions, callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void): void;
    (hostname: string, options: LookupOneOptions, callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void): void;
    (hostname: string, options: LookupOptions, callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void): void;
    (hostname: string, callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void): void;
  }
  
  export interface LookupOptions extends LookupOneOptions, LookupAllOptions {}
  
  export interface LookupOneOptions {
    family?: number;
    hints?: number;
  }
  
  export interface LookupAllOptions {
    all: true;
    family?: number;
    hints?: number;
  }
  
  export interface LookupAddress {
    address: string;
    family: number;
  }
  
  export interface TcpSocketConnectOpts {
    port: number;
    host?: string;
    localAddress?: string;
    localPort?: number;
    family?: number;
    hints?: number;
    lookup?: LookupFunction;
    noDelay?: boolean;
    keepAlive?: boolean;
    keepAliveInitialDelay?: number;
  }
  
  export interface IpcSocketConnectOpts {
    path: string;
  }
  
  export type SocketConnectOpts = TcpSocketConnectOpts | IpcSocketConnectOpts;
}

// http module additional types
declare module "node:http" {
  export interface ServerOptions {
    IncomingMessage?: typeof IncomingMessage;
    ServerResponse?: typeof ServerResponse;
    maxHeaderSize?: number;
    insecureHTTPParser?: boolean;
    keepAliveTimeout?: number;
    headersTimeout?: number;
    requestTimeout?: number;
  }
  
  export interface RequestOptions {
    method?: string;
    headers?: any;
    auth?: string;
    protocol?: string;
    host?: string;
    hostname?: string;
    port?: number;
    path?: string;
    agent?: any;
    defaultPort?: number;
    family?: number;
    lookup?: any;
    timeout?: number;
    setHost?: boolean;
    createConnection?: any;
  }
  
  export interface IncomingMessage extends NodeJS.ReadableStream {
    httpVersion: string;
    httpVersionMajor: number;
    httpVersionMinor: number;
    complete: boolean;
    readonly headers: any;
    readonly rawHeaders: string[];
    readonly trailers: any;
    readonly rawTrailers: string[];
    setTimeout(msecs: number, callback?: () => void): this;
    readonly method?: string;
    readonly url?: string;
    readonly statusCode?: number;
    readonly statusMessage?: string;
    readonly socket: any;
    readonly connection: any;
  }
  
  export interface OutgoingMessage extends NodeJS.WritableStream {
    writableFinished: boolean;
    chunkedEncoding: boolean;
    shouldKeepAlive: boolean;
    useChunkedEncodingByDefault: boolean;
    sendDate: boolean;
    finished: boolean;
    headersSent: boolean;
    connection: any;
    socket: any;
    setTimeout(msecs: number, callback?: () => void): this;
    setHeader(name: string, value: string | string[]): void;
    getHeader(name: string): string | string[] | undefined;
    getHeaders(): any;
    getHeaderNames(): string[];
    hasHeader(name: string): boolean;
    removeHeader(name: string): void;
    addTrailers(headers: any): void;
    flushHeaders(): void;
  }
  
  export interface ServerResponse extends OutgoingMessage {
    statusCode: number;
    statusMessage: string;
    readonly headersSent: boolean;
    readonly finished: boolean;
    assignSocket(socket: any): void;
    detachSocket(socket: any): void;
    writeContinue(callback?: () => void): void;
    writeHead(statusCode: number, statusMessage?: string, headers?: any): void;
    writeHead(statusCode: number, headers?: any): void;
  }
}

// https module types
declare module "node:https" {
  import { RequestOptions } from "node:http";
  import { Server as HttpServer } from "node:http";
  import { TLSSocket } from "node:tls";
  
  export interface ServerOptions {
    pfx?: string | Buffer | string[] | Buffer[] | any[];
    key?: string | Buffer | string[] | Buffer[] | any[];
    passphrase?: string;
    cert?: string | Buffer | string[] | Buffer[];
    ca?: string | Buffer | string[] | Buffer[];
    ciphers?: string;
    honorCipherOrder?: boolean;
    ecdhCurve?: string;
    clientCertEngine?: string;
    crl?: string | string[] | Buffer | Buffer[];
    dhparam?: string | Buffer;
    secureProtocol?: string;
    secureOptions?: number;
    sessionTimeout?: number;
    ticketKeys?: Buffer;
    sessionIdContext?: string;
    requestCert?: boolean;
    rejectUnauthorized?: boolean;
    NPNProtocols?: string[] | Buffer[] | Uint8Array[] | Buffer;
    ALPNProtocols?: string[] | Buffer[] | Uint8Array[] | Buffer;
    SNICallback?: (servername: string, cb: (err: Error | null, ctx?: any) => void) => void;
  }
  
  export interface RequestOptions extends RequestOptions {
    pfx?: string | Buffer | string[] | Buffer[] | any[];
    key?: string | Buffer | string[] | Buffer[] | any[];
    passphrase?: string;
    cert?: string | Buffer | string[] | Buffer[];
    ca?: string | Buffer | string[] | Buffer[];
    ciphers?: string;
    honorCipherOrder?: boolean;
    ecdhCurve?: string;
    clientCertEngine?: string;
    crl?: string | string[] | Buffer | Buffer[];
    dhparam?: string | Buffer;
    secureProtocol?: string;
    secureOptions?: number;
    sessionTimeout?: number;
    ticketKeys?: Buffer;
    sessionIdContext?: string;
    rejectUnauthorized?: boolean;
    NPNProtocols?: string[] | Buffer[] | Uint8Array[] | Buffer;
    ALPNProtocols?: string[] | Buffer[] | Uint8Array[] | Buffer;
    SNICallback?: (servername: string, cb: (err: Error | null, ctx?: any) => void) => void;
    servername?: string;
    checkServerIdentity?: (hostname: string, cert: any) => Error | undefined;
    minDHSize?: number;
    agent?: any;
  }
  
  export interface Server extends HttpServer {
    addContext(hostName: string, credentials: any): void;
    removeContext(hostName: string): void;
    setSecureContext(options: any): void;
  }
  
  export function request(options: RequestOptions, callback?: (res: any) => void): any;
  export function request(url: string | URL, options: RequestOptions, callback?: (res: any) => void): any;
  export function get(options: RequestOptions, callback?: (res: any) => void): any;
  export function get(url: string | URL, options: RequestOptions, callback?: (res: any) => void): any;
  export function createServer(options: ServerOptions, requestListener?: (req: any, res: any) => void): Server;
  export const globalAgent: any;
}

// stream/promises module types
declare module "node:stream/promises" {
  export interface FinishedOptions {
    error?: boolean;
    readable?: boolean;
    writable?: boolean;
  }
  
  export interface PipelineOptions {
    end?: boolean;
    signal?: AbortSignal;
  }
  
  export function finished(stream: NodeJS.ReadableStream | NodeJS.WritableStream | NodeJS.ReadWriteStream, options?: FinishedOptions): Promise<void>;
  export function pipeline(...streams: Array<NodeJS.ReadableStream | NodeJS.WritableStream | any>): Promise<any>;
}

// stream/consumers module types
declare module "node:stream/consumers" {
  export function buffer(stream: NodeJS.ReadableStream): Promise<Buffer>;
  export function text(stream: NodeJS.ReadableStream): Promise<string>;
  export function arrayBuffer(stream: NodeJS.ReadableStream): Promise<ArrayBuffer>;
  export function json(stream: NodeJS.ReadableStream): Promise<any>;
}

// stream/web additional types
declare module "node:stream/web" {
  export interface ReadableStreamGenericTransform {
    writable: any;
    readable: any;
  }
  
  export interface ReadableWritablePair<R = any, W = any> {
    readable: ReadableStream<R>;
    writable: WritableStream<W>;
  }
  
  export interface StreamPipeOptions {
    preventClose?: boolean;
    preventAbort?: boolean;
    preventCancel?: boolean;
    signal?: AbortSignal;
  }
  
  export interface TransformStreamI<T = any, U = any> {
    readonly readable: ReadableStream<U>;
    readonly writable: WritableStream<T>;
  }
  
  export interface TransformStreamOptions<T = any, U = any> {
    transform?: Transformer<T, U>;
    flush?: TransformerFlushCallback<U>;
    readableType?: any;
    writableType?: any;
  }
  
  export interface Transformer<T = any, U = any> {
    start?: TransformerStartCallback<U>;
    transform?: TransformerTransformCallback<T, U>;
    flush?: TransformerFlushCallback<U>;
    cancel?: TransformerCancelCallback;
  }
  
  export type TransformerStartCallback<O> = (controller: TransformStreamDefaultController<O>) => void | PromiseLike<void>;
  export type TransformerTransformCallback<I, O> = (chunk: I, controller: TransformStreamDefaultController<O>) => void | PromiseLike<void>;
  export type TransformerFlushCallback<O> = (controller: TransformStreamDefaultController<O>) => void | PromiseLike<void>;
  export type TransformerCancelCallback = (reason: any) => void | PromiseLike<void>;
  
  export class TransformStream<T = any, U = any> implements TransformStreamI<T, U> {
    constructor(transformer?: Transformer<T, U>, writableStrategy?: QueuingStrategy<U>, readableStrategy?: QueuingStrategy<T>);
    readonly readable: ReadableStream<U>;
    readonly writable: WritableStream<T>;
  }
}

// v8 module additional types
declare module "node:v8" {
  export interface HeapSpaceStatistics {
    space_name: string;
    space_size: number;
    space_used_size: number;
    space_available_size: number;
    physical_space_size: number;
  }
  
  export interface HeapCodeStatistics {
    code_and_metadata_size: number;
    bytecode_and_metadata_size: number;
    external_script_source_size: number;
  }
  
  export interface HeapSnapshotOptions {
    exposeInternals?: boolean;
    exposeNumericValues?: boolean;
  }
  
  export interface SerializeDeserializeOptions {
    serialization?: any;
  }
  
  export function writeHeapSnapshot(heapSnapshotOptions?: HeapSnapshotOptions): string;
  export function getHeapStatistics(): HeapStatistics;
  export function getHeapSpaceStatistics(): HeapSpaceStatistics[];
  export function getHeapCodeStatistics(): HeapCodeStatistics;
  export function setFlagsFromString(flags: string): void;
  export function serialize(value: any): Buffer;
  export function deserialize(buffer: Buffer): any;
}

// os module additional types
declare module "node:os" {
  export interface CpuInfo {
    model: string;
    speed: number;
    times: {
      user: number;
      nice: number;
      sys: number;
      idle: number;
      irq: number;
    };
  }
  
  export interface NetworkInterfaceBase {
    address: string;
    netmask: string;
    mac: string;
    internal: boolean;
    cidr: string | null;
  }
  
  export interface NetworkInterfaceInfoIPv4 extends NetworkInterfaceBase {
    family: "IPv4";
  }
  
  export interface NetworkInterfaceInfoIPv6 extends NetworkInterfaceBase {
    family: "IPv6";
    scopeid: number;
  }
  
  export type NetworkInterfaceInfo = NetworkInterfaceInfoIPv4 | NetworkInterfaceInfoIPv6;
  
  export interface UserInfo<T = string> {
    username: T;
    uid: number;
    gid: number;
    shell: T;
    homedir: T;
  }
  
  export function hostname(): string;
  export function loadavg(): number[];
  export function uptime(): number;
  export function freemem(): number;
  export function totalmem(): number;
  export function cpus(): CpuInfo[];
  export function type(): string;
  export function release(): string;
  export function networkInterfaces(): Record<string, NetworkInterfaceInfo[]>;
  export function homedir(): string;
  export function tmpdir(): string;
  export function userInfo(options?: { encoding: BufferEncoding }): UserInfo<string>;
  export function constants: {
    UV_UDP_REUSEADDR: number;
    signals: Record<string, number>;
    errno: Record<string, number>;
    windows: Record<string, number> | null;
    priority: Record<string, number>;
  };
}

// path module additional types
declare module "node:path" {
  export interface PathObject {
    dir: string;
    root: string;
    base: string;
    name: string;
    ext: string;
  }
  
  export function basename(path: string, ext?: string): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
  export function format(pathObject: PathObject): string;
  export function join(...paths: string[]): string;
  export function normalize(path: string): string;
  export function parse(path: string): PathObject;
  export function relative(from: string, to: string): string;
  export function resolve(...pathSegments: string[]): string;
  export function sep: string;
  export function delimiter: string;
  export function win32: typeof import("node:path");
  export function posix: typeof import("node:path");
  export function isAbsolute(path: string): boolean;
  export function toNamespacedPath(path: string): string;
}

// url module additional types
declare module "node:url" {
  export interface UrlObject {
    protocol?: string | null;
    slashes?: boolean | null;
    auth?: string | null;
    host?: string | null;
    port?: string | number | null;
    hostname?: string | null;
    hash?: string | null;
    search?: string | null;
    query?: string | null | any;
    pathname?: string | null;
    path?: string | null;
    href?: string | null;
  }
  
  export interface Url {
    protocol: string | null;
    slashes: boolean | null;
    auth: string | null;
    host: string | null;
    port: string | null;
    hostname: string | null;
    hash: string | null;
    search: string | null;
    query: string | null | any;
    pathname: string | null;
    path: string | null;
    href: string;
  }
  
  export interface ParseOptions {
    decodeQueryString?: boolean;
  }
  
  export interface FormatOptions {
    auth?: boolean;
    fragment?: boolean;
    search?: boolean;
    unicode?: boolean;
  }
  
  export function parse(url: string, parseQueryString?: boolean, slashesDenoteHost?: boolean): Url;
  export function format(urlObject: UrlObject | string, options?: FormatOptions): string;
  export function resolve(from: string, to: string): string;
  export function resolveObject(from: string, to: string): Url;
  export function domainToASCII(domain: string): string;
  export function domainToUnicode(domain: string): string;
  export function pathToFileURL(path: string): URL;
  export function fileURLToPath(url: string | URL): string;
}

// assert module types
declare module "node:assert" {
  export interface AssertionErrorOptions {
    message?: string;
    actual?: any;
    expected?: any;
    operator?: string;
    stackStartFn?: Function;
  }
  
  export class AssertionError extends Error {
    actual: any;
    expected: any;
    operator: string;
    generatedMessage: boolean;
    code: string;
  }
  
  export class CallTracker {
    calls(func: Function, specifics?: any): Function;
    report(): CallTrackerReportInformation[];
    reset(): void;
    verify(): void;
  }
  
  export interface CallTrackerReportInformation {
    message: string;
    actual: number;
    expected: number;
    operator: string;
    stack: Function;
  }
  
  export function assert(value: any, message?: string | Error): asserts value;
  export function fail(message?: string | Error): never;
  export function ok(value: any, message?: string | Error): asserts value;
  export function equal(actual: any, expected: any, message?: string | Error): void;
  export function notEqual(actual: any, expected: any, message?: string | Error): void;
  export function deepEqual(actual: any, expected: any, message?: string | Error): void;
  export function notDeepEqual(actual: any, expected: any, message?: string | Error): void;
  export function strictEqual(actual: any, expected: any, message?: string | Error): void;
  export function notStrictEqual(actual: any, expected: any, message?: string | Error): void;
  export function deepStrictEqual(actual: any, expected: any, message?: string | Error): void;
  export function notDeepStrictEqual(actual: any, expected: any, message?: string | Error): void;
  export function match(value: string, regexp: RegExp, message?: string | Error): void;
  export function doesNotMatch(value: string, regexp: RegExp, message?: string | Error): void;
  export function throws(block: Function, message?: string | Error): void;
  export function throws(block: Function, error: RegExp | Function | any, message?: string | Error): void;
  export function doesNotThrow(block: Function, message?: string | Error): void;
  export function ifError(value: any): void;
  export function rejects(block: Function | Promise<any>, message?: string | Error): Promise<void>;
  export function rejects(block: Function | Promise<any>, error: RegExp | Function | any, message?: string | Error): Promise<void>;
  export function doesNotReject(block: Function | Promise<any>, message?: string | Error): Promise<void>;
}

// util module additional types
declare module "node:util" {
  export function format(format?: any, ...param: any[]): string;
  export function formatWithOptions(inspectOptions: any, format?: any, ...param: any[]): string;
  export function inspect(object: any, options?: any): string;
  export function isArray(value: any): value is any[];
  export function isBoolean(value: any): value is boolean;
  export function isNull(value: any): value is null;
  export function isNullOrUndefined(value: any): value is null | undefined;
  export function isNumber(value: any): value is number;
  export function isString(value: any): value is string;
  export function isSymbol(value: any): value is symbol;
  export function isUndefined(value: any): value is undefined;
  export function isObject(value: any): value is object;
  export function isError(e: any): e is Error;
  export function isFunction(value: any): value is Function;
  export function isRegExp(value: any): value is RegExp;
  export function isPrimitive(value: any): boolean;
  export function isBuffer(value: any): value is Buffer;
  export function isDeepStrictEqual(val1: any, val2: any): boolean;
  export function promisify<T>(fn: Function): T;
  export function callbackify(fn: Function): Function;
  export function types: {
    isAnyArrayBuffer(value: any): value is ArrayBuffer;
    isArrayBufferView(value: any): value is any;
    isArgumentsObject(value: any): boolean;
    isBigInt64Array(value: any): value is BigInt64Array;
    isBigUint64Array(value: any): value is BigUint64Array;
    isBooleanObject(value: any): value is Boolean;
    isBoxedPrimitive(value: any): boolean;
    isDataView(value: any): value is DataView;
    isDate(value: any): value is Date;
    isFloat32Array(value: any): value is Float32Array;
    isFloat64Array(value: any): value is Float64Array;
    isGeneratorFunction(value: any): value is GeneratorFunction;
    isGeneratorObject(value: any): boolean;
    isInt8Array(value: any): value is Int8Array;
    isInt16Array(value: any): value is Int16Array;
    isInt32Array(value: any): value is Int32Array;
    isMap(value: any): value is Map<any, any>;
    isMapIterator(value: any): boolean;
    isModuleNamespaceObject(value: any): boolean;
    isNativeError(value: any): value is Error;
    isNumberObject(value: any): value is Number;
    isPromise(value: any): value is Promise<any>;
    isProxy(value: any): boolean;
    isRegExp(value: any): value is RegExp;
    isSet(value: any): value is Set<any>;
    isSetIterator(value: any): boolean;
    isSharedArrayBuffer(value: any): value is SharedArrayBuffer;
    isStringObject(value: any): value is String;
    isSymbolObject(value: any): value is Symbol;
    isTypedArray(value: any): value is any;
    isUint8Array(value: any): value is Uint8Array;
    isUint8ClampedArray(value: any): value is Uint8ClampedArray;
    isUint16Array(value: any): value is Uint16Array;
    isUint32Array(value: any): value is Uint32Array;
    isWeakMap(value: any): value is WeakMap<any, any>;
    isWeakSet(value: any): value is WeakSet<any>;
  };
}

// events module additional types
declare module "node:events" {
  export interface EventEmitterOptions {
    captureRejections?: boolean;
  }
  
  export interface EventEmitterAsyncResource extends EventEmitter {
    asyncResource: any;
    asyncId: number;
    triggerAsyncId: number;
  }
  
  export interface NodeEventTarget {
    once(eventName: string | symbol, listener: (...args: any[]) => void): this;
  }
  
  export interface DOMEventTarget {
    addEventListener(eventName: string, listener: (...args: any[]) => void, opts?: any): any;
    removeEventListener(eventName: string, listener: (...args: any[]) => void, opts?: any): any;
  }
  
  export function on(emitter: EventEmitter, eventName: string): AsyncIterableIterator<any>;
  export function once(emitter: NodeEventTarget, eventName: string | symbol): Promise<any[]>;
  export function once(emitter: DOMEventTarget, eventName: string): Promise<any[]>;
  export function getEventListeners(emitter: EventEmitter | DOMEventTarget, name: string | symbol): Function[];
  export function getMaxListeners(emitter: EventEmitter | DOMEventTarget): number;
  export function listenerCount(emitter: EventEmitter, eventName: string | symbol): number;
}

// string_decoder module types
declare module "node:string_decoder" {
  export interface StringDecoderOptions {
    encoding?: BufferEncoding;
  }
  
  export class StringDecoder {
    constructor(encoding?: BufferEncoding);
    constructor(options?: StringDecoderOptions);
    write(buffer: Buffer): string;
    end(buffer?: Buffer): string;
    readonly encoding: BufferEncoding;
  }
}

// diagnostics_channel module types


// async_hooks module types
declare module "node:async_hooks" {
  export interface AsyncResourceOptions {
    triggerAsyncId?: number;
    requireManualDestroy?: boolean;
  }
  
  export interface HookCallbacks {
    init(asyncId: number, type: string, triggerAsyncId: number, resource: object): void;
    before(asyncId: number): void;
    after(asyncId: number): void;
    destroy(asyncId: number): void;
    promiseResolve(asyncId: number): void;
  }
  
  export interface AsyncHook {
    enable(): this;
    disable(): this;
  }
  
  export class AsyncResource {
    constructor(type: string, options?: AsyncResourceOptions);
    readonly asyncId: number;
    readonly triggerAsyncId: number;
    emitBefore(asyncId: number, type: string, triggerAsyncId: number): void;
    emitAfter(asyncId: number): void;
    emitDestroy(): void;
    asyncId(): number;
    triggerAsyncId(): number;
    runInAsyncScope<This, Result>(fn: (this: This) => Result, thisArg?: This, ...args: any[]): Result;
    runInAsyncScope<This, Result>(fn: (this: This, ...args: any[]) => Result, thisArg?: This, ...args: any[]): Result;
    bindToCurrentContext(): this;
  }
  
  export function createHook(callbacks: HookCallbacks): AsyncHook;
  export function executionAsyncResource(): object;
  export function executionAsyncId(): number;
  export function triggerAsyncId(): number;
}

// worker_threads module additional types
declare module "node:worker_threads" {
  export interface WorkerOptions {
    eval?: boolean;
    filename?: string;
    workerData?: any;
    stdin?: boolean;
    stdout?: boolean;
    stderr?: boolean;
    env?: Record<string, string>;
    execArgv?: string[];
    resourceLimits?: ResourceLimits;
    argv?: string[];
    trackUnmanagedFds?: boolean;
  }
  
  export interface ResourceLimits {
    maxYoungGenerationSizeMb?: number;
    maxOldGenerationSizeMb?: number;
    codeRangeSizeMb?: number;
  }
  
  export interface WorkerPerformance {
    duration: number;
    nodeStartTime: number;
  }
  
  export interface BroadcastChannel extends NodeJS.EventEmitter {
    readonly name: string;
    postMessage(message: any): void;
    close(): void;
    onmessage: (message: any) => void;
    onmessageerror: (error: Error) => void;
  }
  
  export class MessagePort extends EventEmitter {
    postMessage(value: any, transferList?: any[]): void;
    start(): void;
    close(): void;
    ref(): void;
    unref(): void;
    setMaxListeners(n: number): this;
    getMaxListeners(): number;
  }
  
  export class MessageChannel {
    readonly port1: MessagePort;
    readonly port2: MessagePort;
  }
  
  export class Worker extends EventEmitter {
    readonly stdin: any;
    readonly stdout: any;
    readonly stderr: any;
    readonly threadId: number;
    readonly resourceLimits?: ResourceLimits;
    postMessage(value: any, transferList?: any[]): void;
    terminate(): Promise<number>;
  }
}

// fs/promises module types


// child_process module additional types
declare module "node:child_process" {
  import { EventEmitter } from "node:events";
  import { Readable, Writable } from "node:stream";
  
  export interface ChildProcess extends EventEmitter {
    readonly stdin: Writable | null;
    readonly stdout: Readable | null;
    readonly stderr: Readable | null;
    readonly readonly stdin: Readable | null;
    readonly readonly stdout: Readable | null;
    readonly readonly stderr: Readable | null;
    readonly pid: number;
    readonly connected: boolean;
    readonly exitCode: number | null;
    readonly signalCode: NodeJS.Signals | null;
    readonly spawnargs: string[];
    readonly spawnfile: string;
    kill(signal?: NodeJS.Signals | number): boolean;
    send(message: any, sendHandle?: any, options?: any, callback?: (error: Error | null) => void): boolean;
    disconnect(): void;
    unref(): void;
    ref(): void;
  }
  
  export interface SpawnOptions {
    cwd?: string;
    env?: Record<string, string>;
    argv0?: string;
    stdio?: any;
    detached?: boolean;
    shell?: boolean | string;
    uid?: number;
    gid?: number;
    windowsHide?: boolean;
    windowsVerbatimArguments?: boolean;
  }
  
  export interface SpawnOptionsWithStdioTuple<Stdin, Stdout, Stderr> extends SpawnOptions {
    stdio: [Stdin, Stdout, Stderr];
  }
  
  export interface ExecOptions extends SpawnOptions {
    shell?: string;
    maxBuffer?: number;
    killSignal?: NodeJS.Signals | number;
    timeout?: number;
  }
  
  export interface ExecSyncOptions extends ExecOptions {
    input?: string | Buffer;
    encoding?: BufferEncoding;
  }
  
  export interface ForkOptions extends SpawnOptions {
    silent?: boolean;
    execPath?: string;
    execArgv?: string[];
  }
  
  export function spawn(command: string, args?: string[], options?: SpawnOptions): ChildProcess;
  export function exec(command: string, options?: ExecOptions, callback?: (error: ExecException | null, stdout: string, stderr: string) => void): ChildProcess;
  export function exec(command: string, callback?: (error: ExecException | null, stdout: string, stderr: string) => void): ChildProcess;
  export function execSync(command: string, options?: ExecSyncOptions): Buffer | string;
  export function execFileSync(command: string, args?: string[], options?: ExecSyncOptions): Buffer | string;
  export function fork(modulePath: string, args?: string[], options?: ForkOptions): ChildProcess;
  export interface ExecException extends Error {
    cmd?: string;
    killed?: boolean;
    code?: number;
    signal?: NodeJS.Signals;
  }
}

// module module additional types


// zlib module additional types
declare module "node:zlib" {
  import { Transform, TransformOptions } from "node:stream";
  
  export interface ZlibOptions extends TransformOptions {
    flush?: number;
    finishFlush?: number;
    chunkSize?: number;
    windowBits?: number;
    level?: number;
    memLevel?: number;
    strategy?: number;
    dictionary?: Buffer | Buffer[] | any;
    info?: boolean;
  }
  
  export interface BrotliOptions extends TransformOptions {
    chunkSize?: number;
    flush?: number;
    finishFlush?: number;
    params?: {
      [key: number]: number;
    };
    maxOutputLength?: number;
  }
  
  export interface CompressionOptions {
    level?: number;
    windowBits?: number;
    memLevel?: number;
    strategy?: number;
    dictionary?: Buffer | Buffer[];
  }
  
  export class ZlibBase extends Transform {}
  
  export class Zlib extends ZlibBase {}
  export class Gzip extends Zlib {}
  export class Gunzip extends Zlib {}
  export class Deflate extends Zlib {}
  export class Inflate extends Zlib {}
  export class DeflateRaw extends Zlib {}
  export class InflateRaw extends Zlib {}
  export class Unzip extends Zlib {}
  
  export class BrotliCompress extends Transform {}
  export class BrotliDecompress extends Transform {}
  
  export function createGzip(options?: ZlibOptions): Gzip;
  export function createGunzip(options?: ZlibOptions): Gunzip;
  export function createDeflate(options?: ZlibOptions): Deflate;
  export function createInflate(options?: ZlibOptions): Inflate;
  export function createDeflateRaw(options?: ZlibOptions): DeflateRaw;
  export function createInflateRaw(options?: ZlibOptions): InflateRaw;
  export function createUnzip(options?: ZlibOptions): Unzip;
  export function createBrotliCompress(options?: BrotliOptions): BrotliCompress;
  export function createBrotliDecompress(options?: BrotliOptions): BrotliDecompress;
  
  export function gzip(buffer: Buffer | string, options?: ZlibOptions, callback: (error: Error | null, result: Buffer) => void): void;
  export function gzipSync(buffer: Buffer | string, options?: ZlibOptions): Buffer;
  export function gunzip(buffer: Buffer | string, options?: ZlibOptions, callback: (error: Error | null, result: Buffer) => void): void;
  export function gunzipSync(buffer: Buffer | string, options?: ZlibOptions): Buffer;
  export function deflate(buffer: Buffer | string, options?: ZlibOptions, callback: (error: Error | null, result: Buffer) => void): void;
  export function deflateSync(buffer: Buffer | string, options?: ZlibOptions): Buffer;
  export function inflate(buffer: Buffer | string, options?: ZlibOptions, callback: (error: Error | null, result: Buffer) => void): void;
  export function inflateSync(buffer: Buffer | string, options?: ZlibOptions): Buffer;
}

// perf_hooks module types


// trace_events module types
declare module "node:trace_events" {
  export interface TracingOptions {
    categories?: string[];
    filename?: string;
  }
  
  export interface Tracing {
    enabled: boolean;
    categories: string[];
    enable(): void;
    disable(): void;
  }
  
  export function createTracing(options?: TracingOptions): Tracing;
}

// constants module types
declare module "node:constants" {
  export const EE_SEP: string;
  export const ERROR_PURGE_CUTOFF: number;
  export const SSL_OP_ALL: number;
  export const SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION: number;
  export const SSL_OP_CIPHER_SERVER_PREFERENCE: number;
  export const SSL_OP_CISCO_ANYCONNECT: number;
  export const SSL_OP_COOKIE_EXCHANGE: number;
  export const SSL_OP_CRYPTOPRO_TLSEXT_BUG: number;
  export const SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS: number;
  export const SSL_OP_EPHEMERAL_RSA: number;
  export const SSL_OP_LEGACY_SERVER_CONNECT: number;
  export const SSL_OP_MICROSOFT_BIG_SSLV3_BUFFER: number;
  export const SSL_OP_MICROSOFT_SESS_ID_BUG: number;
  export const SSL_OP_MSIE_SSLV2_RSA_PADDING: number;
  export const SSL_OP_NETSCAPE_CA_DN_BUG: number;
  export const SSL_OP_NETSCAPE_CHALLENGE_BUG: number;
  export const SSL_OP_NETSCAPE_DEMO_CIPHER_CHANGE_BUG: number;
  export const SSL_OP_NETSCAPE_REUSE_CIPHER_CHANGE_BUG: number;
  export const SSL_OP_NO_CLIENT_RENEGOTIATION: number;
  export const SSL_OP_NO_COMPRESSION: number;
  export const SSL_OP_NO_QUERY_MTU: number;
  export const SSL_OP_NO_RENEGOTIATION: number;
  export const SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION: number;
  export const SSL_OP_NO_SSLv2: number;
  export const SSL_OP_NO_SSLv3: number;
  export const SSL_OP_NO_TICKET: number;
  export const SSL_OP_NO_TLSv1: number;
  export const SSL_OP_NO_TLSv1_1: number;
  export const SSL_OP_NO_TLSv1_2: number;
  export const SSL_OP_NO_TLSv1_3: number;
  export const SSL_OP_PKCS1_CHECK_1: number;
  export const SSL_OP_PKCS1_CHECK_2: number;
  export const SSL_OP_PRIORITIZE_CHACHA: number;
  export const SSL_OP_SINGLE_DH_USE: number;
  export const SSL_OP_SINGLE_ECDH_USE: number;
  export const SSL_OP_SSLEAY_080_CLIENT_DH_BUG: number;
  export const SSL_OP_SSLREF2_REUSE_CERT_TYPE_BUG: number;
  export const SSL_OP_TLS_BLOCK_PADDING_BUG: number;
  export const SSL_OP_TLS_D5_BUG: number;
  export const SSL_OP_TLS_ROLLBACK_BUG: number;
}

// timers/promises module types
declare module "node:timers/promises" {
  export interface Abortable {
    signal: AbortSignal;
  }
  
  export interface TimerOptions extends Abortable {
    ref?: boolean;
  }
  
  export function setTimeout(ms: number, value?: any): Promise<void>;
  export function setTimeout(ms: number, value: any, options: TimerOptions): Promise<void>;
  export function setImmediate(value?: any): Promise<void>;
  export function setImmediate(value: any, options: TimerOptions): Promise<void>;
  export function setInterval(ms: number, value?: any): AsyncIterable<any>;
}

// domain module types (deprecated)
declare module "node:domain" {
  import { EventEmitter } from "node:events";
  
  export class Domain extends EventEmitter {
    readonly members: any[];
    run(fn: Function): void;
    add(emitter: EventEmitter): void;
    remove(emitter: EventEmitter): void;
    bind(fn: Function): Function;
    intercept(fn: Function): Function;
    enter(): void;
    exit(): void;
  }
  
  export function create(): Domain;
}

// vm module additional types
declare module "node:vm" {
  export interface Context extends any {}
  
  export interface RunningCodeOptions {
    filename?: string;
    lineOffset?: number;
    columnOffset?: number;
    displayErrors?: boolean;
    timeout?: number;
    breakOnSigint?: boolean;
  }
  
  export interface CompileOptions extends RunningCodeOptions {
    produceCachedData?: boolean;
    cachedData?: Buffer;
  }
  
  export interface ScriptOptions extends CompileOptions {
    filename?: string;
    columnOffset?: number;
    lineOffset?: number;
  }
  
  export interface CreateContextOptions {
    name?: string;
    origin?: string;
    codeGeneration?: {
      strings?: boolean;
      wasm?: boolean;
    };
  }
  
  export interface MeasureMemoryOptions {
    mode?: "summary" | "detailed";
  }
  
  export interface MeasureMemory {
    memory: MeasureMemoryMemoryUsage;
  }
  
  export interface MeasureMemoryMemoryUsage {
    total: {
      jsMemoryEstimate: number;
      jsMemoryRange: [number, number];
    };
  }
  
  export class Script {
    constructor(code: string, options?: ScriptOptions);
    runInContext(contextifiedObject: Context, options?: RunningCodeOptions): any;
    runInNewContext(sandbox?: Context, options?: RunningCodeOptions): any;
    runInThisContext(options?: RunningCodeOptions): any;
    createCachedData(): Buffer;
    cachedDataProduced?: boolean;
    cachedDataRejected?: boolean;
    cachedData?: Buffer;
    sourceMapURL?: string;
  }
  
  export function createContext(sandbox?: Context, options?: CreateContextOptions): Context;
  export function isContext(sandbox: Context): boolean;
  export function runInContext(code: string, contextifiedObject: Context, options?: RunningCodeOptions): any;
  export function runInNewContext(code: string, sandbox?: Context, options?: RunningCodeOptions): any;
  export function runInThisContext(code: string, options?: RunningCodeOptions): any;
  export function compileFunction(code: string, params?: string[], options?: CompileOptions): Function;
}

// inspector module types
declare module "node:inspector" {
  export class Console {
    constructor();
    log(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
    dir(object: any, options?: any): void;
    time(label?: string): void;
    timeEnd(label?: string): void;
    trace(): void;
    assert(expression: any, ...args: any[]): void;
  }
  
  export class Session extends EventEmitter {
    connect(): void;
    connect(mainSession: Session): void;
    disconnect(): void;
    post(method: string, params?: any, callback?: (err: Error | null, result: any) => void): void;
    post(method: string, callback?: (err: Error | null, result: any) => void): void;
  }
  
  export function open(port?: number, host?: string, wait?: boolean): void;
  export function url(): string;
  export const console: Console;
}

// punycode module types (deprecated)
declare module "node:punycode" {
  export function decode(input: string): string;
  export function encode(input: string): string;
  export function toASCII(input: string): string;
  export function toUnicode(input: string): string;
  export const ucs2: {
    decode(input: string): number[];
    encode(codePoints: number[]): string;
  };
  export function version: string;
}

// readline/promises module types
declare module "node:readline/promises" {
  import { Interface as ReadlineInterface } from "node:readline";
  
  export interface ReadLineOptions {
    input: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    completer?: Completer | AsyncCompleter;
    terminal?: boolean;
    history?: string[];
    historySize?: number;
    prompt?: string;
    crlfDelay?: number;
    removeHistoryDuplicates?: boolean;
    escapeCodeTimeout?: number;
    tabSize?: number;
  }
  
  export type Completer = (line: string) => [string[], string];
  export type AsyncCompleter = (line: string) => Promise<[string[], string]>;
  
  export class Interface extends ReadlineInterface {
    question(query: string): Promise<string>;
  }
  
  export function createInterface(options: ReadLineOptions): Interface;
}

// process additional types
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      [key: string]: string | undefined;
    }
    
    interface ProcessRelease {
      name: string;
      sourceUrl?: string;
      headersUrl?: string;
      libUrl?: string;
      lts?: string;
    }
    
    interface ProcessVersions {
      node: string;
      bun: string;
      v8: string;
      uv: string;
      zlib: string;
      brotli: string;
      ares: string;
      modules: string;
      openssl: string;
    }
    
    interface ProcessReport {
      writeReport(fileName?: string, err?: Error): string;
      getReport(err?: Error): string;
      directory: string;
      filename: string;
      compact: boolean;
      triggerReport(signal: string, filename?: string): boolean;
      onSignal(signal: string): void;
    }
    
    interface Process extends EventEmitter {
      report?: ProcessReport;
      allowedNodeEnvironmentFlags: Set<string>;
      arch: string;
      argv: string[];
      argv0: string;
      config: any;
      connected: boolean;
      debugPort: number;
      env: ProcessEnv;
      execArgv: string[];
      execPath: string;
      exitCode: number;
      mainModule?: Module;
      noDeprecation: boolean;
      pid: number;
      ppid: number;
      platform: NodeJS.Platform;
      release: ProcessRelease;
      title: string;
      version: string;
      versions: ProcessVersions;
      on(event: "beforeExit", listener: (exitCode: number) => void): this;
      on(event: "disconnect", listener: () => void): this;
      on(event: "exit", listener: (exitCode: number) => void): this;
      on(event: "message", listener: (message: any) => void): this;
      on(event: "multipleResolves", listener: (type: string, promise: Promise<any>, value: any) => void): this;
      on(event: "rejectionHandled", listener: (promise: Promise<any>) => void): this;
      on(event: "uncaughtException", listener: (error: Error) => void): this;
      on(event: "unhandledRejection", listener: (reason: any, promise: Promise<any>) => void): this;
      on(event: "warning", listener: (warning: Error) => void): this;
    }
  }
}

// buffer module additional types
declare module "node:buffer" {
  export interface BufferConstructor {
    alloc(size: number): Buffer;
    alloc(size: number, fill: string, encoding?: BufferEncoding): Buffer;
    alloc(size: number, fill: number): Buffer;
    alloc(size: number, fill: Buffer): Buffer;
    allocUnsafe(size: number): Buffer;
    allocUnsafeSlow(size: number): Buffer;
    byteLength(string: string | Buffer | ArrayBufferView | ArrayBuffer | SharedArrayBuffer, encoding?: BufferEncoding): number;
    compare(a: Buffer, b: Buffer): number;
    concat(list: Buffer[], totalLength?: number): Buffer;
    from(array: number[]): Buffer;
    from(arrayBuffer: ArrayBuffer | SharedArrayBuffer, byteOffset?: number, length?: number): Buffer;
    from(buffer: Buffer): Buffer;
    from(data: any, encoding?: BufferEncoding): Buffer;
    from(string: string, encoding?: BufferEncoding): Buffer;
    isBuffer(obj: any): obj is Buffer;
    isEncoding(encoding: string): encoding is BufferEncoding;
    poolSize: number;
  }
  
  export const Buffer: BufferConstructor;
  
  export const constants: {
    MAX_LENGTH: number;
    MAX_STRING_LENGTH: number;
  };
  
  export const INSPECT_MAX_BYTES: number;
}

// stream additional types
declare module "node:stream" {
  export interface ReadableOptions {
    highWaterMark?: number;
    encoding?: BufferEncoding;
    objectMode?: boolean;
    read?: (this: Readable, size: number) => void;
    destroy?: (this: Readable, error: Error | null, callback: (error: Error | null) => void) => void;
  }
  
  export interface WritableOptions {
    highWaterMark?: number;
    decodeStrings?: boolean;
    defaultEncoding?: BufferEncoding;
    objectMode?: boolean;
    emitClose?: boolean;
    write?: (this: Writable, chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void) => boolean;
    writev?: (this: Writable, chunks: Array<{ chunk: any; encoding: BufferEncoding }>, callback: (error?: Error | null) => void) => boolean;
    destroy?: (this: Writable, error: Error | null, callback: (error: Error | null) => void) => void;
    final?: (this: Writable, callback: (error?: Error | null) => void) => void;
  }
  
  export interface DuplexOptions extends ReadableOptions, WritableOptions {
    allowHalfOpen?: boolean;
    readableObjectMode?: boolean;
    writableObjectMode?: boolean;
  }
  
  export interface TransformOptions extends DuplexOptions {
    transform?: (this: Transform, chunk: any, encoding: BufferEncoding, callback: TransformCallback) => void;
    flush?: (this: Transform, callback: TransformCallback) => void;
  }
  
  export type TransformCallback = (error?: Error | null, data?: any) => void;
  
  export class Readable extends EventEmitter implements NodeJS.ReadableStream {
    readable: boolean;
    readonly readableEncoding: BufferEncoding | null;
    readonly readableEnded: boolean;
    readonly readableFlowing: boolean | null;
    readonly readableHighWaterMark: number;
    readonly readableLength: number;
    readonly readableObjectMode: boolean;
    readonly destroyed: boolean;
    read(size?: number): any;
    setEncoding(encoding: BufferEncoding): this;
    pause(): this;
    resume(): this;
    isPaused(): boolean;
    unpipe(destination?: NodeJS.WritableStream): this;
    unshift(chunk: any, encoding?: BufferEncoding): void;
    wrap(oldStream: NodeJS.ReadableStream): this;
    push(chunk: any, encoding?: BufferEncoding): boolean;
    destroy(error?: Error): void;
    _destroy(error: Error | null, callback: (error: Error | null) => void): void;
  }
  
  export class Writable extends EventEmitter implements NodeJS.WritableStream {
    writable: boolean;
    readonly writableEnded: boolean;
    readonly writableFinished: boolean;
    readonly writableHighWaterMark: number;
    readonly writableObjectMode: boolean;
    readonly writableCorked: number;
    readonly destroyed: boolean;
    write(chunk: any, cb?: (error: Error | null) => void): boolean;
    write(chunk: any, encoding: BufferEncoding, cb?: (error: Error | null) => void): boolean;
    setDefaultEncoding(encoding: BufferEncoding): this;
    cork(): void;
    uncork(): void;
    end(cb?: () => void): void;
    end(chunk: any, cb?: () => void): void;
    end(chunk: any, encoding: BufferEncoding, cb?: () => void): void;
    destroy(error?: Error): void;
    _destroy(error: Error | null, callback: (error: Error | null) => void): void;
  }
  
  export class Duplex extends Readable implements NodeJS.ReadWriteStream {
    readonly writable: boolean;
    readonly writableEnded: boolean;
    readonly writableFinished: boolean;
    readonly writableHighWaterMark: number;
    readonly writableObjectMode: boolean;
    readonly writableCorked: number;
    allowHalfOpen: boolean;
  }
  
  export class Transform extends Duplex {}
  
  export class PassThrough extends Transform {}
  
  export function finished(stream: NodeJS.ReadableStream | NodeJS.WritableStream | NodeJS.ReadWriteStream, options: any, callback: (err?: Error | null) => void): () => void;
  export function pipeline(...streams: Array<NodeJS.ReadableStream | NodeJS.WritableStream | Function>): NodeJS.WritableStream;
}

// crypto additional types


// fs additional types
declare module "node:fs" {
  export interface StatsBase<T> {
    isFile(): boolean;
    isDirectory(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isSymbolicLink(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
    dev: T;
    ino: T;
    mode: T;
    nlink: T;
    uid: T;
    gid: T;
    rdev: T;
    size: T;
    blksize: T;
    blocks: T;
    atimeMs: T;
    mtimeMs: T;
    ctimeMs: T;
    birthtimeMs: T;
    atime: Date;
    mtime: Date;
    ctime: Date;
    birthtime: Date;
  }
  
  export interface Stats extends StatsBase<number> {}
  
  export interface BigIntStats extends StatsBase<bigint> {}
  
  export interface OpenOptions {
    flags?: string | number;
    mode?: number;
    fs?: any;
  }
  
  export interface OpenDirOptions {
    encoding?: BufferEncoding | null;
    bufferSize?: number;
  }
  
  export interface ReadSyncOptions {
    buffer?: Buffer;
    offset?: number;
    length?: number;
    position?: number;
  }
  
  export interface WriteSyncOptions {
    buffer?: Buffer;
    offset?: number;
    length?: number;
    position?: number;
  }
  
  export interface ReadVResult {
    bytesRead: number;
    buffers: Buffer[];
  }
  
  export interface WriteVResult {
    bytesWritten: number;
    buffers: Buffer[];
  }
}

// dns module additional types
declare module "node:dns" {
  export interface LookupOptions {
    family?: number;
    hints?: number;
    all?: boolean;
    verbatim?: boolean;
  }
  
  export interface LookupOneAddress {
    address: string;
    family: number;
  }
  
  export interface LookupAllAddresses {
    address: string;
    family: number;
  }
  
  export interface RecordWithTtl {
    address: string;
    ttl: number;
  }
  
  export interface AnyRecord {
    type: string;
    value: any;
  }
  
  export interface ResolveOptions {
    ttl?: boolean;
  }
  
  export interface ResolveWithTtlOptions extends ResolveOptions {
    ttl: true;
  }
  
  export interface ResolverOptions {
    timeout?: number;
    tries?: number;
  }
  
  export function lookup(hostname: string, callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void): void;
  export function lookup(hostname: string, options: LookupOptions, callback: (err: NodeJS.ErrnoException | null, address: string | LookupOneAddress[], family: number) => void): void;
  export function resolve(hostname: string, callback: (err: NodeJS.ErrnoException | null, addresses: string[]) => void): void;
  export function resolve(hostname: string, rrtype: string, callback: (err: NodeJS.ErrnoException | null, addresses: string[] | AnyRecord[]) => void): void;
  export function resolveAny(hostname: string, callback: (err: NodeJS.ErrnoException | null, addresses: AnyRecord[]) => void): void;
  export function resolve4(hostname: string, callback: (err: NodeJS.ErrnoException | null, addresses: string[]) => void): void;
  export function resolve6(hostname: string, callback: (err: NodeJS.ErrnoException | null, addresses: string[]) => void): void;
  export function resolveCname(hostname: string, callback: (err: NodeJS.ErrnoException | null, addresses: string[]) => void): void;
  export function resolveMx(hostname: string, callback: (err: NodeJS.ErrnoException | null, addresses: any[]) => void): void;
  export function resolveNs(hostname: string, callback: (err: NodeJS.ErrnoException | null, addresses: string[]) => void): void;
  export function resolveTxt(hostname: string, callback: (err: NodeJS.ErrnoException | null, addresses: string[][]) => void): void;
  export function resolveSrv(hostname: string, callback: (err: NodeJS.ErrnoException | null, addresses: any[]) => void): void;
  export function resolvePtr(hostname: string, callback: (err: NodeJS.ErrnoException | null, addresses: string[]) => void): void;
  export function reverse(ip: string, callback: (err: NodeJS.ErrnoException | null, hostnames: string[]) => void): void;
}

// http2 module additional types
declare module "node:http2" {
  export interface ServerOptions {
    maxDeflateDynamicTableSize?: number;
    maxSessionMemory?: number;
    maxHeaderListPairs?: number;
    maxOutstandingPings?: number;
    maxSendHeaderBlockLength?: number;
    maxConcurrentStreams?: number;
    settings?: any;
    onSessionHandlers?: any;
  }
  
  export interface SessionOptions {
    maxDeflateDynamicTableSize?: number;
    maxSessionMemory?: number;
    maxHeaderListPairs?: number;
    maxOutstandingPings?: number;
    maxSendHeaderBlockLength?: number;
    settings?: any;
  }
  
  export interface ClientSessionOptions extends SessionOptions {
    maxReservedRemoteStreams?: number;
    createConnection?: any;
  }
  
  export interface ClientOptions extends ClientSessionOptions {
    protocol?: string;
    authority?: string;
  }
  
  export interface StatOptions {
    offset?: number;
    length?: number;
  }
  
  export class Http2Session extends EventEmitter {
    readonly alpnProtocol: string;
    readonly closed: boolean;
    readonly destroyed: boolean;
    readonly localSettings: any;
    readonly remoteSettings: any;
    readonly originSet: string[];
    readonly socket: any;
    readonly type: number;
    readonly unackedPingCount: number;
    close(callback?: () => void): void;
    destroy(error?: Error, code?: number): void;
    goaway(code?: number, lastStreamID?: number, opaqueData?: Buffer): void;
    ping(callback?: (err: Error | null, duration: number, payload: Buffer) => void): boolean;
    ref(): void;
    unref(): void;
    settings(settings: any): void;
  }
  
  export class ServerHttp2Session extends Http2Session {
    readonly server: any;
  }
}

// tls additional types (extended)


// url module additional types (extended)


// Web API: Fetch additional types
declare global {
  interface RequestInit {
    method?: string;
    headers?: any;
    body?: BodyInit | null;
    referrer?: string;
    referrerPolicy?: ReferrerPolicy;
    mode?: RequestMode;
    credentials?: RequestCredentials;
    redirect?: RequestRedirect;
    integrity?: string;
    keepalive?: boolean;
    signal?: AbortSignal | null;
    window?: null;
    duplex?: any;
  }
  
  interface ResponseInit {
    status?: number;
    statusText?: string;
    headers?: any;
  }
  
  type RequestMode = "navigate" | "same-origin" | "no-cors" | "cors";
  type RequestCredentials = "omit" | "same-origin" | "include";
  type RequestRedirect = "follow" | "error" | "manual";
  type ReferrerPolicy = "" | "no-referrer" | "no-referrer-when-downgrade" | "same-origin" | "origin" | "strict-origin" | "origin-when-cross-origin" | "strict-origin-when-cross-origin" | "unsafe-url";
  type RequestDestination = "" | "audio" | "audioworklet" | "document" | "embed" | "font" | "frame" | "iframe" | "image" | "manifest" | "object" | "paintworklet" | "script" | "style" | "track" | "video" | "worker" | "xslt";
}

// Web API: Headers additional types
declare global {
  class Headers {
    constructor(init?: HeadersInit);
    append(name: string, value: string): void;
    delete(name: string): void;
    get(name: string): string | null;
    has(name: string): boolean;
    set(name: string, value: string): void;
    forEach(callback: (value: string, key: string, parent: Headers) => void, thisArg?: any): void;
    entries(): IterableIterator<[string, string]>;
    keys(): IterableIterator<string>;
    values(): IterableIterator<string>;
    readonly [Symbol.iterator](): IterableIterator<[string, string]>;
  }
  
  type HeadersInit = Headers | string[][] | Record<string, string>;
}

// Web API: FormData additional types
declare global {
  class FormData {
    constructor(form?: HTMLFormElement);
    append(name: string, value: string | Blob, fileName?: string): void;
    delete(name: string): void;
    get(name: string): FormDataEntryValue | null;
    getAll(name: string): FormDataEntryValue[];
    has(name: string): boolean;
    set(name: string, value: string | Blob, fileName?: string): void;
    forEach(callback: (value: FormDataEntryValue, key: string, parent: FormData) => void, thisArg?: any): void;
    entries(): IterableIterator<[string, FormDataEntryValue]>;
    keys(): IterableIterator<string>;
    values(): IterableIterator<FormDataEntryValue>;
    readonly [Symbol.iterator](): IterableIterator<[string, FormDataEntryValue]>;
  }
  
  type FormDataEntryValue = File | string;
}

// Web API: File additional types
declare global {
  class File extends Blob {
    constructor(fileBits: BlobPart[], fileName: string, options?: FilePropertyBag);
    readonly lastModified: number;
    readonly name: string;
  }
  
  interface FilePropertyBag extends BlobPropertyBag {
    lastModified?: number;
  }
  
  type BlobPart = Buffer | Blob | string;
  
  interface BlobPropertyBag {
    type?: string;
    endings?: "transparent" | "native";
  }
  
  class Blob {
    constructor(blobParts?: BlobPart[], options?: BlobPropertyBag);
    readonly size: number;
    readonly type: string;
    arrayBuffer(): Promise<ArrayBuffer>;
    bytes(): Promise<Uint8Array>;
    slice(start?: number, end?: number, contentType?: string): Blob;
    stream(): ReadableStream;
    text(): Promise<string>;
  }
}

// Web API: AbortController additional types
declare global {
  class AbortController {
    constructor();
    readonly signal: AbortSignal;
    abort(reason?: any): void;
  }
  
  interface AbortSignalEventMap {
    abort: any;
  }
  
  interface AbortSignal extends EventTarget {
    readonly aborted: boolean;
    readonly reason: any;
    onabort: ((this: AbortSignal, ev: Event) => any) | null;
    throwIfAborted(): void;
  }
  
  var AbortSignal: {
    prototype: AbortSignal;
    new(): AbortSignal;
    abort(reason?: any): AbortSignal;
    timeout(ms: number): AbortSignal;
  };
}

// Web API: EventTarget additional types
declare global {
  class EventTarget {
    constructor();
    addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void;
    dispatchEvent(event: Event): boolean;
    removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void;
  }
  
  interface EventListenerOptions {
    capture?: boolean;
  }
  
  interface AddEventListenerOptions extends EventListenerOptions {
    once?: boolean;
    passive?: boolean;
    signal?: AbortSignal;
  }
  
  interface EventListener {
    (evt: Event): void;
  }
  
  interface EventListenerObject {
    handleEvent(object: Event): void;
  }
  
  type EventListenerOrEventListenerObject = EventListener | EventListenerObject;
}

// Web API: ReadableStream additional types
declare global {
  interface ReadableStreamDefaultController<T> {
    readonly desiredSize: number | null;
    close(): void;
    enqueue(chunk: T): void;
    error(e?: any): void;
  }
  
  interface ReadableStreamDefaultReader<R> {
    readonly closed: Promise<undefined>;
    cancel(reason?: any): Promise<void>;
    read(): Promise<ReadableStreamReadResult<R>>;
    releaseLock(): void;
  }
  
  type ReadableStreamReadResult<T> = ReadableStreamReadValueResult<T> | ReadableStreamReadDoneResult;
  
  interface ReadableStreamReadValueResult<T> {
    done: false;
    value: T;
  }
  
  interface ReadableStreamReadDoneResult {
    done: true;
    value?: undefined;
  }
  
  interface ReadableByteStreamController {
    readonly byobRequest: any;
    readonly desiredSize: number | null;
    close(): void;
    enqueue(chunk: Buffer): void;
    error(e?: any): void;
  }
  
  interface ReadableStreamBYOBReader {
    readonly closed: Promise<undefined>;
    cancel(reason?: any): Promise<void>;
    read(view: Buffer): Promise<ReadableStreamReadResult<Buffer>>;
    releaseLock(): void;
  }
}

// Web API: WritableStream additional types
declare global {
  interface WritableStreamDefaultController {
    error(e?: any): void;
  }
  
  interface WritableStreamDefaultWriter {
    readonly closed: Promise<undefined>;
    readonly desiredSize: number | null;
    readonly ready: Promise<undefined>;
    abort(reason?: any): Promise<void>;
    close(): Promise<void>;
    releaseLock(): void;
    write(chunk: any): Promise<void>;
  }
  
  interface UnderlyingSinkAbortCallback {
    (reason: any): Promise<void> | void;
  }
  
  interface UnderlyingSinkCloseCallback {
    (): Promise<void> | void;
  }
  
  interface UnderlyingSinkStartCallback {
    (controller: WritableStreamDefaultController): any;
  }
  
  interface UnderlyingSinkWriteCallback<W> {
    (chunk: W, controller: WritableStreamDefaultController): Promise<void> | void;
  }
}

// Web API: TransformStream additional types
declare global {
  interface TransformStreamDefaultController<O> {
    readonly desiredSize: number | null;
    enqueue(chunk: O): void;
    error(reason?: any): void;
    terminate(): void;
  }
  
  interface Transformer<I = any, O = any> {
    start?: TransformerStartCallback<O>;
    transform?: TransformerTransformCallback<I, O>;
    flush?: TransformerFlushCallback<O>;
    readableType?: any;
    writableType?: any;
  }
  
  type TransformerStartCallback<O> = (controller: TransformStreamDefaultController<O>) => void | PromiseLike<void>;
  
  type TransformerTransformCallback<I, O> = (chunk: I, controller: TransformStreamDefaultController<O>) => void | PromiseLike<void>;
  
  type TransformerFlushCallback<O> = (controller: TransformStreamDefaultController<O>) => void | PromiseLike<void>;
  
  interface TransformStreamI<I = any, O = any> {
    readonly readable: ReadableStream<O>;
    readonly writable: WritableStream<I>;
  }
}

// Web API: TextEncoder/TextDecoder additional types
declare global {
  class TextEncoder {
    constructor();
    readonly encoding: "utf-8";
    encode(input?: string): Uint8Array;
    encodeInto(input: string, dest: Uint8Array): TextEncoderEncodeIntoResult;
  }
  
  interface TextEncoderEncodeIntoResult {
    read?: number;
    written: number;
  }
  
  class TextDecoder {
    constructor(label?: string, options?: TextDecoderOptions);
    readonly encoding: string;
    readonly fatal: boolean;
    readonly ignoreBOM: boolean;
    decode(input?: Buffer | ArrayBuffer | ArrayBufferView, options?: StreamDecodeOptions): string;
  }
  
  interface TextDecoderOptions {
    fatal?: boolean;
    ignoreBOM?: boolean;
  }
  
  interface StreamDecodeOptions {
    stream?: boolean;
  }
  
  var TextDecoder: {
    prototype: TextDecoder;
    new(label?: string, options?: TextDecoderOptions): TextDecoder;
  };
}

// Web API: WebSocket additional types
declare global {
  class WebSocket extends EventTarget {
    constructor(url: string | URL, protocols?: string | string[]);
    readonly binaryType: BinaryType;
    readonly bufferedAmount: number;
    readonly extensions: string;
    onclose: ((this: WebSocket, ev: CloseEvent) => any) | null;
    onerror: ((this: WebSocket, ev: Event) => any) | null;
    onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null;
    onopen: ((this: WebSocket, ev: Event) => any) | null;
    readonly protocol: string;
    readonly readyState: number;
    readonly url: string;
    close(code?: number, reason?: string): void;
    send(data: string | Buffer | ArrayBuffer | ArrayBufferView): void;
    readonly CLOSED: number;
    readonly CLOSING: number;
    CONNECTING: number;
    readonly OPEN: number;
    addEventListener<K extends keyof WebSocketEventMap>(type: K, listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  }
  
  interface WebSocketEventMap {
    close: CloseEvent;
    error: Event;
    message: MessageEvent;
    open: Event;
  }
  
  type BinaryType = "blob" | "arraybuffer";
}

// Web API: URL and URLSearchParams additional types
declare global {
  class URL {
    constructor(url: string, base?: string | URL);
    hash: string;
    host: string;
    hostname: string;
    href: string;
    readonly origin: string;
    password: string;
    pathname: string;
    port: string;
    protocol: string;
    search: string;
    readonly searchParams: URLSearchParams;
    username: string;
    toJSON(): string;
    toString(): string;
  }
  
  class URLSearchParams {
    constructor(init?: string[][] | Record<string, string> | string | URLSearchParams);
    append(name: string, value: string): void;
    delete(name: string): void;
    entries(): IterableIterator<[string, string]>;
    forEach(callback: (value: string, key: string, searchParams: this) => void): void;
    get(name: string): string | null;
    getAll(name: string): string[];
    has(name: string): boolean;
    keys(): IterableIterator<string>;
    set(name: string, value: string): void;
    sort(): void;
    toString(): string;
    values(): IterableIterator<string>;
    readonly size: number;
  }
}

// Web API: Performance additional types
declare global {
  interface Performance {
    readonly timeOrigin: number;
    clearMarks(markName?: string): void;
    clearMeasures(measureName?: string): void;
    clearResourceTimings(): void;
    getEntries(): PerformanceEntry[];
    getEntriesByName(name: string, type?: string): PerformanceEntry[];
    getEntriesByType(type: string): PerformanceEntry[];
    mark(name: string): void;
    measure(name: string, startMark?: string, endMark?: string): void;
    now(): number;
    setResourceTimingBufferSize(maxSize: number): void;
    toJSON(): any;
  }
  
  interface PerformanceEntry {
    readonly duration: number;
    readonly entryType: string;
    readonly name: string;
    readonly startTime: number;
    toJSON(): any;
  }
  
  interface PerformanceMark extends PerformanceEntry {
    readonly entryType: "mark";
  }
  
  interface PerformanceMeasure extends PerformanceEntry {
    readonly entryType: "measure";
  }
}

// Web API: Event additional types
declare global {
  interface Event {
    readonly bubbles: boolean;
    cancelable: boolean;
    readonly composed: boolean;
    currentTarget: EventTarget | null;
    readonly defaultPrevented: boolean;
    readonly eventPhase: number;
    readonly isTrusted: boolean;
    returnValue: boolean;
    readonly srcElement: Element | null;
    readonly target: EventTarget | null;
    readonly timeStamp: number;
    readonly type: string;
    composedPath(): EventTarget[];
    preventDefault(): void;
    stopImmediatePropagation(): void;
    stopPropagation(): void;
    readonly AT_TARGET: number;
    readonly BUBBLING_PHASE: number;
    readonly CAPTURING_PHASE: number;
    readonly NONE: number;
  }
  
  var Event: {
    prototype: Event;
    new(type: string, eventInitDict?: EventInit): Event;
  };
  
  interface EventInit {
    bubbles?: boolean;
    cancelable?: boolean;
    composed?: boolean;
  }
  
  interface CustomEvent<T = any> extends Event {
    readonly detail: T;
    initCustomEvent(type: string, bubbles?: boolean, cancelable?: boolean, detail?: T): void;
  }
  
  var CustomEvent: {
    prototype: CustomEvent;
    new<T = any>(type: string, eventInitDict?: CustomEventInit<T>): CustomEvent<T>;
  };
  
  interface CustomEventInit<T = any> extends EventInit {
    detail?: T;
  }
}

// Web API: ErrorEvent additional types
declare global {
  interface ErrorEvent extends Event {
    readonly colno: number;
    readonly error: any;
    readonly filename: string;
    readonly lineno: number;
    readonly message: string;
  }
  
  var ErrorEvent: {
    prototype: ErrorEvent;
    new(type: string, eventInitDict?: ErrorEventInit): ErrorEvent;
  };
  
  interface ErrorEventInit extends EventInit {
    colno?: number;
    error?: any;
    filename?: string;
    lineno?: number;
    message?: string;
  }
  
  interface MessageEvent<T = any> extends Event {
    readonly data: T;
    readonly lastEventId: string;
    readonly origin: string;
    readonly ports: MessagePort[] | null;
    readonly source: MessageEventSource | null;
    initMessageEvent(type: string, bubbles?: boolean, cancelable?: boolean, data?: any, origin?: string, lastEventId?: string): void;
  }
  
  var MessageEvent: {
    prototype: MessageEvent;
    new<T = any>(type: string, eventInitDict?: MessageEventInit<T>): MessageEvent<T>;
  };
  
  interface MessageEventInit<T = any> extends EventInit {
    data?: T;
    lastEventId?: string;
    origin?: string;
    ports?: MessagePort[];
    source?: MessageEventSource | null;
  }
  
  type MessageEventSource = Window | MessagePort;
}

// Web API: CloseEvent additional types
declare global {
  interface CloseEvent extends Event {
    readonly code: number;
    readonly reason: string;
    readonly wasClean: boolean;
  }
  
  var CloseEvent: {
    prototype: CloseEvent;
    new(type: string, eventInitDict?: CloseEventInit): CloseEvent;
  };
  
  interface CloseEventInit extends EventInit {
    code?: number;
    reason?: string;
    wasClean?: boolean;
  }
  
  interface ProgressEvent<T = any> extends Event {
    readonly lengthComputable: boolean;
    readonly loaded: number;
    readonly total: number;
    readonly target: T;
  }
  
  var ProgressEvent: {
    prototype: ProgressEvent;
    new<T = any>(type: string, eventInitDict?: ProgressEventInit<T>): ProgressEvent<T>;
  };
  
  interface ProgressEventInit<T = any> extends EventInit {
    lengthComputable?: boolean;
    loaded?: number;
    total?: number;
  }
}

// Web API: atob/btoa additional types
declare global {
  function atob(data: string): string;
  function btoa(data: string): string;
}

// Web API: setTimeout/setInterval additional types
declare global {
  function setTimeout(handler: TimerHandler, timeout?: number, ...arguments: any[]): number;
  function setInterval(handler: TimerHandler, timeout?: number, ...arguments: any[]): number;
  function clearTimeout(timeoutId: number): void;
  function clearInterval(intervalId: number): void;
  function queueMicrotask(callback: Function): void;
  
  type TimerHandler = string | Function;
}

// Web API: console additional types
declare global {
  namespace NodeJS {
    interface Console {
      Console: console.ConsoleConstructor;
      assert(value: any, message?: string, ...optionalParams: any[]): void;
      dir(obj: any, options?: any): void;
      error(message?: any, ...optionalParams: any[]): void;
      info(message?: any, ...optionalParams: any[]): void;
      log(message?: any, ...optionalParams: any[]): void;
      time(label?: string): void;
      timeEnd(label?: string): void;
      timeLog(label?: string, ...data: any[]): void;
      trace(message?: any, ...optionalParams: any[]): void;
      warn(message?: any, ...optionalParams: any[]): void;
      debug(message?: any, ...optionalParams: any[]): void;
      clear(): void;
      count(label?: string): void;
      countReset(label?: string): void;
      group(...label: any[]): void;
      groupCollapsed(...label: any[]): void;
      groupEnd(): void;
      table(tabularData?: any, properties?: string[]): void;
    }
  }
  
  var console: Console;
}

// Web API: JSON additional types
declare global {
  interface JSON {
    parse(text: string, reviver?: (key: any, value: any) => any): any;
    stringify(value: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number): string | undefined;
    stringify(value: any, replacer?: (number | string)[] | null, space?: string | number): string | undefined;
  }
}

// Web API: Math additional types
declare global {
  interface Math {
    E: number;
    LN10: number;
    LN2: number;
    LOG10E: number;
    LOG2E: number;
    PI: number;
    SQRT1_2: number;
    SQRT2: number;
    abs(x: number): number;
    acos(x: number): number;
    acosh(x: number): number;
    asin(x: number): number;
    asinh(x: number): number;
    atan(x: number): number;
    atan2(y: number, x: number): number;
    atanh(x: number): number;
    cbrt(x: number): number;
    ceil(x: number): number;
    clz32(x: number): number;
    cos(x: number): number;
    cosh(x: number): number;
    exp(x: number): number;
    expm1(x: number): number;
    floor(x: number): number;
    fround(x: number): number;
    hypot(...values: number[]): number;
    imul(x: number, y: number): number;
    log(x: number): number;
    log10(x: number): number;
    log1p(x: number): number;
    log2(x: number): number;
    max(...values: number[]): number;
    min(...values: number[]): number;
    pow(x: number, y: number): number;
    random(): number;
    round(x: number): number;
    sign(x: number): number;
    sin(x: number): number;
    sinh(x: number): number;
    sqrt(x: number): number;
    tan(x: number): number;
    tanh(x: number): number;
    trunc(x: number): number;
  }
}

// Web API: Reflect additional types
declare global {
  namespace Reflect {
    function apply(target: Function, thisArgument: any, argumentsList: ArrayLike<any>): any;
    function construct(target: Function, argumentsList: ArrayLike<any>, newTarget?: Function): any;
    function defineProperty(target: any, propertyKey: PropertyKey, attributes: PropertyDescriptor): boolean;
    function deleteProperty(target: any, propertyKey: PropertyKey): boolean;
    function get(target: any, propertyKey: PropertyKey, receiver?: any): any;
    function getOwnPropertyDescriptor(target: any, propertyKey: PropertyKey): PropertyDescriptor | undefined;
    function getPrototypeOf(target: any): any;
    function has(target: any, propertyKey: PropertyKey): boolean;
    function isExtensible(target: any): boolean;
    function ownKeys(target: any): Array<PropertyKey>;
    function preventExtensions(target: any): boolean;
    function set(target: any, propertyKey: PropertyKey, value: any, receiver?: any): boolean;
    function setPrototypeOf(target: any, proto: any): boolean;
  }
}

// Web API: Symbol additional types
declare global {
    interface Symbol {
        readonly description: string | undefined;
    }
    interface SymbolConstructor {
        (description?: string | number): symbol;
        readonly asyncIterator: symbol;
        readonly hasInstance: symbol;
        readonly isConcatSpreadable: symbol;
        readonly iterator: symbol;
        readonly match: symbol;
        readonly matchAll: symbol;
        readonly replace: symbol;
        readonly search: symbol;
        readonly species: symbol;
        readonly split: symbol;
        readonly toPrimitive: symbol;
        readonly toStringTag: symbol;
        readonly unscopables: symbol;
        for(key: string): symbol;
        keyFor(sym: symbol): string | undefined;
    }
    var Symbol: SymbolConstructor;
}

// Web API: Promise additional types
declare global {
    interface PromiseConstructor {
        all<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>[]>;
        race<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>>;
        reject(reason?: any): Promise<never>;
        resolve(): Promise<void>;
        resolve<T>(value: T | PromiseLike<T>): Promise<Awaited<T>>;
        withResolvers<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: any) => void; };
        any<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>>;
    }
    var Promise: PromiseConstructor;
}

// Web API: Array additional types
declare global {
    interface ArrayConstructor {
        from<T>(arrayLike: ArrayLike<T> | Iterable<T>): T[];
        from<T, U>(arrayLike: ArrayLike<T> | Iterable<T>, mapfn: (v: T, k: number) => U, thisArg?: any): U[];
        of<T>(...items: T[]): T[];
        isArray(arg: any): arg is any[];
    }
    interface Array<T> {
        at(index: number): T | undefined;
        concat(...items: ConcatArray<T>[]): T[];
        concat(...items: (T | ConcatArray<T>)[]): T[];
        copyWithin(target: number, start: number, end?: number): this;
        entries(): IterableIterator<[number, T]>;
        every(callbackfn: (value: T, index: number, array: T[]) => boolean, thisArg?: any): boolean;
        fill(value: T, start?: number, end?: number): this;
        filter(callbackfn: (value: T, index: number, array: T[]) => any, thisArg?: any): T[];
        find(callbackfn: (value: T, index: number, obj: T[]) => boolean, thisArg?: any): T | undefined;
        findIndex(callbackfn: (value: T, index: number, obj: T[]) => boolean, thisArg?: any): number;
        findLast(callbackfn: (value: T, index: number, array: T[]) => boolean, thisArg?: any): T | undefined;
        findLastIndex(callbackfn: (value: T, index: number, array: T[]) => boolean, thisArg?: any): number;
        flat<U>(this: U[][][][][], depth: 4): U[];
        flat<U>(this: U[][][], depth: 3): U[];
        flat<U>(this: U[][], depth: 2): U[];
        flat<U>(this: U[], depth: 1): U[];
        flat<U>(this: U[][], depth?: 1): U[];
        flatMap<U, This>(callback: (this: This, value: T, index: number, array: T[]) => U | ReadonlyArray<U>, thisArg?: This): U[];
        forEach(callbackfn: (value: T, index: number, array: T[]) => void, thisArg?: any): void;
        includes(searchElement: T, fromIndex?: number): boolean;
        indexOf(searchElement: T, fromIndex?: number): number;
        join(separator?: string): string;
        keys(): IterableIterator<number>;
        lastIndexOf(searchElement: T, fromIndex?: number): number;
        map<U>(callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any): U[];
        pop(): T | undefined;
        push(...items: T[]): number;
        reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T;
        reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T;
        reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U;
        reduceRight(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T;
        reduceRight(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T;
        reduceRight<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U;
        reverse(): T[];
        shift(): T | undefined;
        slice(start?: number, end?: number): T[];
        some(callbackfn: (value: T, index: number, array: T[]) => boolean, thisArg?: any): boolean;
        sort(compareFn?: (a: T, b: T) => number): this;
        splice(start: number, deleteCount?: number, ...items: T[]): T[];
        toLocaleString(): string;
        toString(): string;
        unshift(...items: T[]): number;
        values(): IterableIterator<T>;
    }
}

// Web API: Map/Set additional types
declare global {
    interface MapConstructor {
        new(): Map<any, any>;
        new<K, V>(entries?: readonly (readonly [K, V])[] | null): Map<K, V>;
    }
    interface Map<K, V> {
        readonly size: number;
        clear(): void;
        delete(key: K): boolean;
        forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void;
        get(key: K): V | undefined;
        has(key: K): boolean;
        set(key: K, value: V): this;
        entries(): IterableIterator<[K, V]>;
        keys(): IterableIterator<K>;
        values(): IterableIterator<V>;
        [Symbol.iterator](): IterableIterator<[K, V]>;
    }
    interface SetConstructor {
        new(): Set<any>;
        new<T>(values?: readonly T[] | null): Set<T>;
    }
    interface Set<T> {
        readonly size: number;
        add(value: T): this;
        clear(): void;
        delete(value: T): boolean;
        forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void, thisArg?: any): void;
        has(value: T): boolean;
        entries(): IterableIterator<[T, T]>;
        keys(): IterableIterator<T>;
        values(): IterableIterator<T>;
        [Symbol.iterator](): IterableIterator<T>;
    }
    var Map: MapConstructor;
    var Set: SetConstructor;
}

// Web API: WeakMap/WeakSet additional types
declare global {
    interface WeakMapConstructor {
        new(): WeakMap<any, any>;
        new<K extends object, V>(entries?: readonly (readonly [K, V])[] | null): WeakMap<K, V>;
    }
    interface WeakMap<K extends object, V> {
        delete(key: K): boolean;
        get(key: K): V | undefined;
        has(key: K): boolean;
        set(key: K, value: V): this;
    }
    interface WeakSetConstructor {
        new(): WeakSet<object>;
        new<T extends object>(values?: readonly T[] | null): WeakSet<T>;
    }
    interface WeakSet<T extends object> {
        add(value: T): this;
        delete(value: T): boolean;
        has(value: T): boolean;
    }
    var WeakMap: WeakMapConstructor;
    var WeakSet: WeakSetConstructor;
}

// Web API: String additional types
declare global {
    interface String {
        at(index: number): string | undefined;
        charAt(pos: number): string;
        charCodeAt(index: number): number;
        codePointAt(pos: number): number | undefined;
        concat(...strings: string[]): string;
        endsWith(searchString: string, endPosition?: number): boolean;
        includes(searchString: string, position?: number): boolean;
        indexOf(searchString: string, position?: number): number;
        lastIndexOf(searchString: string, position?: number): number;
        localeCompare(that: string): number;
        match(regexp: string | RegExp): RegExpMatchArray | null;
        matchAll(regexp: RegExp): RegExpStringIterator;
        padEnd(maxLength: number, fillString?: string): string;
        padStart(maxLength: number, fillString?: string): string;
        repeat(count: number): string;
        replace(searchValue: string | RegExp, replaceValue: string): string;
        replace(searchValue: string | RegExp, replaceValue: (substring: string, ...args: any[]) => string): string;
        replaceAll(searchValue: string | RegExp, replaceValue: string): string;
        replaceAll(searchValue: string | RegExp, replaceValue: (substring: string) => string): string;
        search(regexp: string | RegExp): number;
        slice(start?: number, end?: number): string;
        split(separator: string | RegExp, limit?: number): string[];
        startsWith(searchString: string, position?: number): boolean;
        substring(start: number, end?: number): string;
        toLocaleLowerCase(locales?: string | string[]): string;
        toLocaleUpperCase(locales?: string | string[]): string;
        toLowerCase(): string;
        toString(): string;
        toUpperCase(): string;
        trim(): string;
        trimEnd(): string;
        trimStart(): string;
        valueOf(): string;
    }
}

// Web API: Number additional types
declare global {
    interface Number {
        toExponential(fractionDigits?: number): string;
        toFixed(fractionDigits?: number): string;
        toLocaleString(locales?: string | string[], options?: Intl.NumberFormatOptions): string;
        toPrecision(precision?: number): string;
        toString(radix?: number): string;
        valueOf(): number;
    }
    interface NumberConstructor {
        (value: any): number;
        readonly EPSILON: number;
        readonly MAX_SAFE_INTEGER: number;
        readonly MAX_VALUE: number;
        readonly MIN_SAFE_INTEGER: number;
        readonly MIN_VALUE: number;
        readonly NaN: number;
        readonly NEGATIVE_INFINITY: number;
        readonly POSITIVE_INFINITY: number;
        isFinite(number: number): boolean;
        isInteger(number: number): boolean;
        isNaN(number: number): boolean;
        isSafeInteger(number: number): boolean;
        parseFloat(string: string): number;
        parseInt(string: string, radix?: number): number;
    }
}

// Web API: BigInt additional types
declare global {
    interface BigInt {
        toString(radix?: number): string;
        valueOf(): bigint;
        readonly [Symbol.toStringTag]: "BigInt";
    }
    interface BigIntConstructor {
        (value: bigint | boolean | number | string): bigint;
        readonly prototype: BigInt;
        asIntN(bits: number, bigint: bigint): bigint;
        asUintN(bits: number, bigint: bigint): bigint;
        toString(): string;
    }
    var BigInt: BigIntConstructor;
}

// Web API: Object additional types
declare global {
    interface ObjectConstructor {
        assign<T extends object>(target: T, ...sources: any[]): T;
        create(o: object | null): any;
        defineProperties<T>(o: T, properties: PropertyDescriptorMap & ThisType<T>): T;
        defineProperty<T>(o: T, p: PropertyKey, attributes: PropertyDescriptor & ThisType<any>): T;
        entries(o: object): [string, any][];
        freeze<T>(a: T): Readonly<T>;
        getOwnPropertyDescriptor(o: any, p: PropertyKey): PropertyDescriptor | undefined;
        getOwnPropertyNames(o: any): string[];
        getOwnPropertySymbols(o: any): symbol[];
        getPrototypeOf(o: any): any;
        groupBy(items: Iterable<any>, keySelector: (item: any, index: number) => unknown): Record<string, any[]>;
        is(value1: any, value2: any): boolean;
        keys(o: object): string[];
        preventExtensions<T>(a: T): T;
        seal<T>(a: T): T;
        setPrototypeOf(o: any, proto: object | null): any;
        values(o: object): any[];
    }
}

// Web API: Date additional types
declare global {
    interface Date {
        toString(): string;
        toDateString(): string;
        toTimeString(): string;
        toLocaleString(locales?: string | string[], options?: Intl.DateTimeFormatOptions): string;
        toLocaleDateString(locales?: string | string[], options?: Intl.DateTimeFormatOptions): string;
        toLocaleTimeString(locales?: string | string[], options?: Intl.DateTimeFormatOptions): string;
        valueOf(): number;
        getTime(): number;
        getFullYear(): number;
        getUTCFullYear(): number;
        getMonth(): number;
        getUTCMonth(): number;
        getDate(): number;
        getUTCDate(): number;
        getDay(): number;
        getUTCDay(): number;
        getHours(): number;
        getUTCHours(): number;
        getMinutes(): number;
        getUTCMinutes(): number;
        getSeconds(): number;
        getUTCSeconds(): number;
        getMilliseconds(): number;
        getUTCMilliseconds(): number;
        getTimezoneOffset(): number;
        setTime(time: number): number;
        setMilliseconds(ms: number): number;
        setUTCMilliseconds(ms: number): number;
        setSeconds(sec: number, ms?: number): number;
        setUTCSeconds(sec: number, ms?: number): number;
        setMinutes(min: number, sec?: number, ms?: number): number;
        setUTCMinutes(min: number, sec?: number, ms?: number): number;
        setHours(hours: number, min?: number, sec?: number, ms?: number): number;
        setUTCHours(hours: number, min?: number, sec?: number, ms?: number): number;
        setDate(date: number): number;
        setUTCDate(date: number): number;
        setMonth(month: number, date?: number): number;
        setUTCMonth(month: number, date?: number): number;
        setFullYear(year: number, month?: number, date?: number): number;
        setUTCFullYear(year: number, month?: number, date?: number): number;
        toUTCString(): string;
        toISOString(): string;
        toJSON(key?: string): string;
    }
}

// Web API: RegExp additional types
declare global {
    interface RegExp {
        exec(string: string): RegExpExecArray | null;
        test(string: string): boolean;
        compile(pattern: string, flags?: string): this;
        readonly dotAll: boolean;
        readonly flags: string;
        readonly global: boolean;
        readonly hasIndices: boolean;
        readonly ignoreCase: boolean;
        readonly lastIndex: number;
        readonly multiline: boolean;
        readonly source: string;
        readonly sticky: boolean;
        readonly unicode: boolean;
        readonly unicodeSets: boolean;
        [Symbol.match](string: string): RegExpMatchArray | null;
        [Symbol.matchAll](string: string): RegExpStringIterator;
        [Symbol.replace](string: string, replaceValue: string): string;
        [Symbol.replace](string: string, replaceValue: (substring: string, ...args: any[]) => string): string;
        [Symbol.search](string: string): number;
        [Symbol.split](string: string, limit?: number): string[];
    }
    interface RegExpConstructor {
        (pattern: RegExp | string, flags?: string): RegExp;
        readonly prototype: RegExp;
    }
    var RegExp: RegExpConstructor;
}

// Web API: Function additional types
declare global {
    interface Function {
        apply(this: Function, thisArg: any, argArray?: any): any;
        call(this: Function, thisArg: any, ...argArray: any[]): any;
        bind(this: Function, thisArg: any, ...argArray: any[]): any;
        toString(): string;
        readonly prototype: any;
        readonly length: number;
        readonly name: string;
    }
    interface FunctionConstructor {
        (...args: string[]): Function;
        readonly prototype: Function;
    }
    var Function: FunctionConstructor;
}

// Web API: Error additional types
declare global {
    interface Error {
        name: string;
        message: string;
        stack?: string;
        cause?: unknown;
    }
    interface ErrorConstructor {
        (message?: string): Error;
        readonly prototype: Error;
    }
    var Error: ErrorConstructor;
    
    interface EvalError extends Error {}
    var EvalError: ErrorConstructor;
    
    interface RangeError extends Error {}
    var RangeError: ErrorConstructor;
    
    interface ReferenceError extends Error {}
    var ReferenceError: ErrorConstructor;
    
    interface SyntaxError extends Error {}
    var SyntaxError: ErrorConstructor;
    
    interface TypeError extends Error {}
    var TypeError: ErrorConstructor;
    
    interface URIError extends Error {}
    var URIError: ErrorConstructor;
}

// Web API: TypedArray additional types
declare global {
    interface TypedArray {
        readonly buffer: ArrayBuffer;
        readonly byteLength: number;
        readonly byteOffset: number;
        readonly length: number;
        subarray(begin?: number, end?: number): any;
        at(index: number): number;
        every(callbackfn: (value: number, index: number, array: any) => boolean, thisArg?: any): boolean;
        fill(value: number, start?: number, end?: number): this;
        filter(callbackfn: (value: number, index: number, array: any) => any, thisArg?: any): any;
        find(callbackfn: (value: number, index: number, array: any) => boolean, thisArg?: any): number | undefined;
        findIndex(callbackfn: (value: number, index: number, array: any) => boolean, thisArg?: any): number;
        forEach(callbackfn: (value: number, index: number, array: any) => void, thisArg?: any): void;
        includes(searchElement: number, fromIndex?: number): boolean;
        indexOf(searchElement: number, fromIndex?: number): number;
        join(separator?: string): string;
        lastIndexOf(searchElement: number, fromIndex?: number): number;
        map(callbackfn: (value: number, index: number, array: any) => number, thisArg?: any): any;
        reduce(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: any) => number): number;
        reduce(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: any) => number, initialValue: number): number;
        reduceRight(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: any) => number): number;
        reduceRight(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: any) => number, initialValue: number): number;
        reverse(): this;
        set(array: ArrayLike<number>, offset?: number): void;
        slice(start?: number, end?: number): any;
        some(callbackfn: (value: number, index: number, array: any) => boolean, thisArg?: any): boolean;
        sort(compareFn?: (a: number, b: number) => number): this;
        at(index: number): number;
        toLocaleString(): string;
    }
}

// Web API: ArrayBuffer additional types
declare global {
    interface ArrayBuffer {
        readonly byteLength: number;
        slice(begin?: number, end?: number): ArrayBuffer;
    }
    interface ArrayBufferConstructor {
        new(byteLength: number): ArrayBuffer;
        isView(arg: any): arg is any;
    }
    var ArrayBuffer: ArrayBufferConstructor;
    
    interface SharedArrayBuffer {
        readonly byteLength: number;
        slice(begin?: number, end?: number): SharedArrayBuffer;
    }
    interface SharedArrayBufferConstructor {
        new(byteLength: number): SharedArrayBuffer;
    }
    var SharedArrayBuffer: SharedArrayBufferConstructor;
}

// Web API: DataView additional types
declare global {
    interface DataView {
        readonly buffer: ArrayBuffer;
        readonly byteLength: number;
        readonly byteOffset: number;
        getFloat32(byteOffset: number, littleEndian?: boolean): number;
        getFloat64(byteOffset: number, littleEndian?: boolean): number;
        getInt8(byteOffset: number): number;
        getInt16(byteOffset: number, littleEndian?: boolean): number;
        getInt32(byteOffset: number, littleEndian?: boolean): number;
        getUint8(byteOffset: number): number;
        getUint16(byteOffset: number, littleEndian?: boolean): number;
        getUint32(byteOffset: number, littleEndian?: boolean): number;
        setFloat32(byteOffset: number, value: number, littleEndian?: boolean): void;
        setFloat64(byteOffset: number, value: number, littleEndian?: boolean): void;
        setInt8(byteOffset: number, value: number): void;
        setInt16(byteOffset: number, value: number, littleEndian?: boolean): void;
        setInt32(byteOffset: number, value: number, littleEndian?: boolean): void;
        setUint8(byteOffset: number, value: number): void;
        setUint16(byteOffset: number, value: number, littleEndian?: boolean): void;
        setUint32(byteOffset: number, value: number, littleEndian?: boolean): void;
    }
    interface DataViewConstructor {
        new(buffer: ArrayBuffer | SharedArrayBuffer, byteOffset?: number, byteLength?: number): DataView;
    }
    var DataView: DataViewConstructor;
}

// Web API: Int8Array additional types
declare global {
    interface Int8ArrayConstructor {
        new(length?: number): Int8Array;
        new(array: ArrayLike<number> | ArrayBufferLike): Int8Array;
        new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): Int8Array;
        readonly prototype: Int8Array;
        BYTES_PER_ELEMENT: number;
    }
    var Int8Array: Int8ArrayConstructor;
    
    interface Uint8ArrayConstructor {
        new(length?: number): Uint8Array;
        new(array: ArrayLike<number> | ArrayBufferLike): Uint8Array;
        new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): Uint8Array;
        readonly prototype: Uint8Array;
        BYTES_PER_ELEMENT: number;
    }
    var Uint8Array: Uint8ArrayConstructor;
}

// Web API: Uint8ClampedArray additional types
declare global {
    interface Uint8ClampedArrayConstructor {
        new(length?: number): Uint8ClampedArray;
        new(array: ArrayLike<number> | ArrayBufferLike): Uint8ClampedArray;
        new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): Uint8ClampedArray;
        readonly prototype: Uint8ClampedArray;
        BYTES_PER_ELEMENT: number;
    }
    var Uint8ClampedArray: Uint8ClampedArrayConstructor;
    
    interface Int16ArrayConstructor {
        new(length?: number): Int16Array;
        new(array: ArrayLike<number> | ArrayBufferLike): Int16Array;
        new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): Int16Array;
        readonly prototype: Int16Array;
        BYTES_PER_ELEMENT: number;
    }
    var Int16Array: Int16ArrayConstructor;
}

// Web API: Uint16Array additional types
declare global {
    interface Uint16ArrayConstructor {
        new(length?: number): Uint16Array;
        new(array: ArrayLike<number> | ArrayBufferLike): Uint16Array;
        new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): Uint16Array;
        readonly prototype: Uint16Array;
        BYTES_PER_ELEMENT: number;
    }
    var Uint16Array: Uint16ArrayConstructor;
    
    interface Int32ArrayConstructor {
        new(length?: number): Int32Array;
        new(array: ArrayLike<number> | ArrayBufferLike): Int32Array;
        new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): Int32Array;
        readonly prototype: Int32Array;
        BYTES_PER_ELEMENT: number;
    }
    var Int32Array: Int32ArrayConstructor;
}

// Web API: Uint32Array additional types
declare global {
    interface Uint32ArrayConstructor {
        new(length?: number): Uint32Array;
        new(array: ArrayLike<number> | ArrayBufferLike): Uint32Array;
        new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): Uint32Array;
        readonly prototype: Uint32Array;
        BYTES_PER_ELEMENT: number;
    }
    var Uint32Array: Uint32ArrayConstructor;
    
    interface Float32ArrayConstructor {
        new(length?: number): Float32Array;
        new(array: ArrayLike<number> | ArrayBufferLike): Float32Array;
        new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): Float32Array;
        readonly prototype: Float32Array;
        BYTES_PER_ELEMENT: number;
    }
    var Float32Array: Float32ArrayConstructor;
}

// Web API: Float64Array and BigInt64Array types
declare global {
    interface Float64ArrayConstructor {
        new(length?: number): Float64Array;
        new(array: ArrayLike<number> | ArrayBufferLike): Float64Array;
        new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): Float64Array;
        readonly prototype: Float64Array;
        BYTES_PER_ELEMENT: number;
    }
    var Float64Array: Float64ArrayConstructor;
    
    interface BigInt64ArrayConstructor {
        new(length?: number): BigInt64Array;
        new(array: ArrayLike<bigint> | ArrayBufferLike): BigInt64Array;
        new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): BigInt64Array;
        readonly prototype: BigInt64Array;
        BYTES_PER_ELEMENT: number;
    }
    var BigInt64Array: BigInt64ArrayConstructor;
}

// Web API: BigUint64Array types
declare global {
    interface BigUint64ArrayConstructor {
        new(length?: number): BigUint64Array;
        new(array: ArrayLike<bigint> | ArrayBufferLike): BigUint64Array;
        new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): BigUint64Array;
        readonly prototype: BigUint64Array;
        BYTES_PER_ELEMENT: number;
    }
    var BigUint64Array: BigUint64ArrayConstructor;
}

// Web API: globalThis properties
declare global {
    var NaN: number;
    var Infinity: number;
    var undefined: any;
    var eval: (x: string) => any;
    var parseInt: (string: string, radix?: number) => number;
    var parseFloat: (string: string) => number;
    var isNaN: (number: number) => boolean;
    var isFinite: (number: number) => boolean;
    var decodeURI: (encodedURI: string) => string;
    var decodeURIComponent: (encodedURIComponent: string) => string;
    var encodeURI: (uri: string) => string;
    var encodeURIComponent: (uriComponent: string) => string;
    var escape: (string: string) => string;
    var unescape: (string: string) => string;
}

// Worker API types
declare global {
    class Worker extends EventTarget {
        constructor(url: string | URL, options?: WorkerOptions);
        postMessage(message: any, transfer?: any[]): void;
        terminate(): void;
        onmessage: ((this: Worker, ev: MessageEvent) => any) | null;
        onmessageerror: ((this: Worker, ev: MessageEvent) => any) | null;
        onerror: ((this: Worker, ev: ErrorEvent) => any) | null;
    }
    
    interface WorkerOptions {
        type?: "classic" | "module";
        credentials?: RequestCredentials;
        name?: string;
    }
}

// MessageChannel types
declare global {
    class MessageChannel {
        readonly port1: MessagePort;
        readonly port2: MessagePort;
    }
    
    interface MessagePort extends EventTarget {
        postMessage(message: any, transfer?: any[]): void;
        close(): void;
        start(): void;
        onmessage: ((this: MessagePort, ev: MessageEvent) => any) | null;
        onmessageerror: ((this: MessagePort, ev: MessageEvent) => any) | null;
    }
}

// BroadcastChannel types
declare global {
    class BroadcastChannel extends EventTarget {
        constructor(name: string);
        readonly name: string;
        postMessage(message: any): void;
        close(): void;
        onmessage: ((this: BroadcastChannel, ev: MessageEvent) => any) | null;
        onmessageerror: ((this: BroadcastChannel, ev: MessageEvent) => any) | null;
    }
}

// Storage API types
declare global {
    interface Storage {
        readonly length: number;
        clear(): void;
        getItem(key: string): string | null;
        key(index: number): string | null;
        removeItem(key: string): void;
        setItem(key: string, value: string): void;
    }
    
    var localStorage: Storage;
    var sessionStorage: Storage;
}

// CustomEvent types
declare global {
    interface CustomEventInit<T = any> extends EventInit {
        detail?: T;
    }
    
    interface CustomEvent<T = any> extends Event {
        readonly detail: T;
        initCustomEvent(type: string, bubbles?: boolean, cancelable?: boolean, detail?: T): void;
    }
    
    var CustomEvent: {
        prototype: CustomEvent;
        new<T = any>(type: string, eventInitDict?: CustomEventInit<T>): CustomEvent<T>;
    };
}

// Atomics types
declare global {
    namespace Atomics {
        function add(typedArray: BigInt64Array | BigUint64Array, index: number, value: bigint): bigint;
        function add(typedArray: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array, index: number, value: number): number;
        function and(typedArray: BigInt64Array | BigUint64Array, index: number, value: bigint): bigint;
        function and(typedArray: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array, index: number, value: number): number;
        function compareExchange(typedArray: BigInt64Array | BigUint64Array, index: number, expectedValue: bigint, replacementValue: bigint): bigint;
        function compareExchange(typedArray: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array, index: number, expectedValue: number, replacementValue: number): number;
        function exchange(typedArray: BigInt64Array | BigUint64Array, index: number, value: bigint): bigint;
        function exchange(typedArray: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array, index: number, value: number): number;
        function isLockFree(size: number): boolean;
        function load(typedArray: BigInt64Array | BigUint64Array, index: number): bigint;
        function load(typedArray: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array, index: number): number;
        function or(typedArray: BigInt64Array | BigUint64Array, index: number, value: bigint): bigint;
        function or(typedArray: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array, index: number, value: number): number;
        function store(typedArray: BigInt64Array | BigUint64Array, index: number, value: bigint): bigint;
        function store(typedArray: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array, index: number, value: number): number;
        function sub(typedArray: BigInt64Array | BigUint64Array, index: number, value: bigint): bigint;
        function sub(typedArray: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array, index: number, value: number): number;
        function wait(typedArray: Int32Array, index: number, value: number, timeout?: number): "ok" | "not-equal" | "timed-out";
        function waitAsync(typedArray: Int32Array, index: number, value: number, timeout?: number): { async: true; value: Promise<"ok" | "not-equal" | "timed-out">; } | { async: false; value: "ok" | "not-equal" | "timed-out"; };
        function notify(typedArray: Int32Array, index: number, count?: number): number;
        function xor(typedArray: BigInt64Array | BigUint64Array, index: number, value: bigint): bigint;
        function xor(typedArray: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array, index: number, value: number): number;
    }
}

// FinalizationRegistry types
declare global {
    interface FinalizationRegistry {
        unregister(unregisterToken: object): boolean;
    }
    
    interface FinalizationRegistryConstructor {
        new(finalizationCallback: (heldValue: any) => void): FinalizationRegistry;
        prototype: FinalizationRegistry;
    }
    
    var FinalizationRegistry: FinalizationRegistryConstructor;
    
    class WeakRef {
        constructor(target: object);
        deref(): object | undefined;
    }
}

// Iterator and AsyncIterator types
declare global {
    interface Iterator {
        next(...args: any[]): IteratorResult;
        return?(value?: any): IteratorResult;
        throw?(e?: any): IteratorResult;
    }
    
    interface IteratorResult<T = any, TReturn = any> {
        done?: boolean;
        value: T | TReturn;
    }
    
    interface Generator extends Iterator {
        next(...args: any[]): IteratorResult;
        return(value: any): IteratorResult;
        throw(e: any): IteratorResult;
        [Symbol.iterator](): Generator;
    }
    
    interface AsyncIterator {
        next(...args: any[]): Promise<IteratorResult>;
        return?(value?: any): Promise<IteratorResult>;
        throw?(e?: any): Promise<IteratorResult>;
    }
    
    interface AsyncGenerator extends AsyncIterator {
        next(...args: any[]): Promise<IteratorResult>;
        return(value: any): Promise<IteratorResult>;
        throw(e: any): Promise<IteratorResult>;
        [Symbol.asyncIterator](): AsyncGenerator;
    }
}

// Generator and AsyncGenerator types
declare global {
    interface GeneratorFunction {
        (...args: any[]): Generator;
        readonly prototype: Generator;
        readonly length: number;
        readonly name: string;
    }
    
    var GeneratorFunction: GeneratorFunctionConstructor;
    
    interface GeneratorFunctionConstructor {
        readonly prototype: GeneratorFunction;
        new(...args: string[]): GeneratorFunction;
        (...args: string[]): GeneratorFunction;
    }
    
    interface AsyncGeneratorFunction {
        (...args: any[]): AsyncGenerator;
        readonly prototype: AsyncGenerator;
        readonly length: number;
        readonly name: string;
    }
    
    var AsyncGeneratorFunction: AsyncGeneratorFunctionConstructor;
    
    interface AsyncGeneratorFunctionConstructor {
        readonly prototype: AsyncGeneratorFunction;
        new(...args: string[]): AsyncGeneratorFunction;
        (...args: string[]): AsyncGeneratorFunction;
    }
}

// Proxy types
declare global {
    interface ProxyHandler<T extends object> {
        getPrototypeOf?: (target: T) => object | null;
        setPrototypeOf?: (target: T, v: any) => boolean;
        isExtensible?: (target: T) => boolean;
        preventExtensions?: (target: T) => boolean;
        getOwnPropertyDescriptor?: (target: T, p: PropertyKey) => PropertyDescriptor | undefined;
        defineProperty?: (target: T, p: PropertyKey, attributes: PropertyDescriptor) => boolean;
        has?: (target: T, p: PropertyKey) => boolean;
        get?: (target: T, p: PropertyKey, receiver: any) => any;
        set?: (target: T, p: PropertyKey, value: any, receiver: any) => boolean;
        deleteProperty?: (target: T, p: PropertyKey) => boolean;
        ownKeys?: (target: T) => Array<PropertyKey>;
        apply?: (target: T, thisArg: any, argArray: any[]) => any;
        construct?: (target: T, argArray: any[], newTarget: Function) => object;
    }
    
    interface ProxyConstructor {
        revocable<T extends object>(target: T, handler: ProxyHandler<T>): { proxy: T; revoke: () => void; };
        new<T extends object>(target: T, handler: ProxyHandler<T>): T;
    }
    
    var Proxy: ProxyConstructor;
}

// Intl API: DateTimeFormat types
declare global {
    namespace Intl {
        interface DateTimeFormatOptions {
            formatMatcher?: "basic" | "best fit";
            hour12?: boolean;
            weekday?: "long" | "short" | "narrow";
            era?: "long" | "short" | "narrow";
            year?: "numeric" | "2-digit";
            month?: "numeric" | "2-digit" | "long" | "short" | "narrow";
            day?: "numeric" | "2-digit";
            hour?: "numeric" | "2-digit";
            minute?: "numeric" | "2-digit";
            second?: "numeric" | "2-digit";
            timeZoneName?: "long" | "short";
            formatMatcher?: "basic" | "best fit";
            timeZone?: string;
            calendar?: string;
            numberingSystem?: string;
            localeMatcher?: "lookup" | "best fit";
        }
        
        interface DateTimeFormat {
            format(date?: Date | number): string;
            formatToParts(date?: Date | number): DateTimeFormatPart[];
            resolvedOptions(): ResolvedDateTimeFormatOptions;
        }
        
        var DateTimeFormat: {
            new(locales?: string | string[], options?: DateTimeFormatOptions): DateTimeFormat;
            (locales?: string | string[], options?: DateTimeFormatOptions): string;
            supportedLocalesOf(locales: string | string[], options?: DateTimeFormatOptions): string[];
        };
    }
}

// Intl API: NumberFormat types
declare global {
    namespace Intl {
        interface NumberFormatOptions {
            localeMatcher?: "lookup" | "best fit";
            style?: "decimal" | "currency" | "percent" | "unit";
            currency?: string;
            currencyDisplay?: "symbol" | "narrowSymbol" | "code" | "name";
            currencySign?: "standard" | "accounting";
            unit?: string;
            unitDisplay?: "short" | "narrow" | "long";
            useGrouping?: boolean;
            minimumIntegerDigits?: number;
            minimumFractionDigits?: number;
            maximumFractionDigits?: number;
            minimumSignificantDigits?: number;
            maximumSignificantDigits?: number;
            notation?: "standard" | "scientific" | "engineering" | "compact";
            compactDisplay?: "short" | "long";
            signDisplay?: "auto" | "always" | "never" | "exceptZero";
        }
        
        interface NumberFormat {
            format(number: number): string;
            formatToParts(number: number): NumberFormatPart[];
            resolvedOptions(): ResolvedNumberFormatOptions;
        }
        
        var NumberFormat: {
            new(locales?: string | string[], options?: NumberFormatOptions): NumberFormat;
            (locales?: string | string[], options?: NumberFormatOptions): string;
            supportedLocalesOf(locales: string | string[], options?: NumberFormatOptions): string[];
        };
    }
}

// Intl API: Collator types
declare global {
    namespace Intl {
        interface CollatorOptions {
            localeMatcher?: "lookup" | "best fit";
            usage?: "sort" | "search";
            sensitivity?: "base" | "accent" | "case" | "variant";
            ignorePunctuation?: boolean;
            numeric?: boolean;
            caseFirst?: "upper" | "lower" | "false";
            collation?: string;
        }
        
        interface Collator {
            compare(x: string, y: string): number;
            resolvedOptions(): ResolvedCollatorOptions;
        }
        
        var Collator: {
            new(locales?: string | string[], options?: CollatorOptions): Collator;
            (locales?: string | string[], options?: CollatorOptions): number;
            supportedLocalesOf(locales: string | string[], options?: CollatorOptions): string[];
        };
    }
}

// Intl API: PluralRules types
declare global {
    namespace Intl {
        type PluralRuleType = "cardinal" | "ordinal";
        type LDMLPluralRule = "zero" | "one" | "two" | "few" | "many" | "other";
        
        interface PluralRulesOptions {
            localeMatcher?: "lookup" | "best fit";
            type?: PluralRuleType;
            minimumIntegerDigits?: number;
            minimumFractionDigits?: number;
            maximumFractionDigits?: number;
            minimumSignificantDigits?: number;
            maximumSignificantDigits?: number;
        }
        
        interface PluralRules {
            select(n: number): LDMLPluralRule;
            resolvedOptions(): ResolvedPluralRulesOptions;
        }
        
        var PluralRules: {
            new(locales?: string | string[], options?: PluralRulesOptions): PluralRules;
            supportedLocalesOf(locales: string | string[], options?: PluralRulesOptions): string[];
        };
    }
}

// Intl API: RelativeTimeFormat types
declare global {
    namespace Intl {
        type RelativeTimeFormatUnit = "year" | "years" | "quarter" | "quarters" | "month" | "months" | "week" | "weeks" | "day" | "days" | "hour" | "hours" | "minute" | "minutes" | "second" | "seconds";
        type RelativeTimeFormatUnitSingular = "year" | "quarter" | "month" | "week" | "day" | "hour" | "minute" | "second";
        
        interface RelativeTimeFormatOptions {
            localeMatcher?: "lookup" | "best fit";
            numeric?: "always" | "auto";
            style?: "long" | "short" | "narrow";
        }
        
        interface RelativeTimeFormat {
            format(value: number, unit: RelativeTimeFormatUnit): string;
            formatToParts(value: number, unit: RelativeTimeFormatUnit): RelativeTimeFormatPart[];
            resolvedOptions(): ResolvedRelativeTimeFormatOptions;
        }
        
        var RelativeTimeFormat: {
            new(locales?: string | string[], options?: RelativeTimeFormatOptions): RelativeTimeFormat;
            supportedLocalesOf(locales: string | string[], options?: RelativeTimeFormatOptions): string[];
        };
    }
}

// Intl API: ListFormat types
declare global {
    namespace Intl {
        type ListFormatType = "conjunction" | "disjunction" | "unit";
        type ListFormatStyle = "long" | "short" | "narrow";
        
        interface ListFormatOptions {
            localeMatcher?: "lookup" | "best fit";
            type?: ListFormatType;
            style?: ListFormatStyle;
        }
        
        interface ListFormat {
            format(elements: string[]): string;
            formatToParts(elements: string[]): ListFormatPart[];
            resolvedOptions(): ResolvedListFormatOptions;
        }
        
        var ListFormat: {
            new(locales?: string | string[], options?: ListFormatOptions): ListFormat;
            supportedLocalesOf(locales: string | string[], options?: ListFormatOptions): string[];
        };
    }
}

// Intl API: DisplayNames types
declare global {
    namespace Intl {
        type DisplayNamesFallback = "code" | "none";
        
        interface DisplayNamesOptions {
            localeMatcher?: "lookup" | "best fit";
            style?: "narrow" | "short" | "long";
            type?: "language" | "region" | "script" | "currency";
            fallback?: DisplayNamesFallback;
            languageDisplay?: "dialect" | "standard";
        }
        
        interface DisplayNames {
            of(code: string): string | undefined;
            resolvedOptions(): ResolvedDisplayNamesOptions;
        }
        
        var DisplayNames: {
            new(locales: string | string[], options: DisplayNamesOptions): DisplayNames;
            supportedLocalesOf(locales: string | string[], options?: DisplayNamesOptions): string[];
        };
    }
}

// Intl API: Locale types
declare global {
    namespace Intl {
        type LocaleUnicodeExtensionType = "ca" | "cu" | "ho" | "kf" | "kn" | "nu";
        
        interface LocaleOptions {
            localeMatcher?: "lookup" | "best fit";
        }
        
        interface LocaleInfo {
            locale: string;
            calendar: string | null;
            caseFirst: string | null;
            collation: string | null;
            hourCycle: string | null;
            numberingSystem: string | null;
            numeric: boolean;
        }
        
        interface Locale {
            readonly locale: string;
            readonly calendar: string | null;
            readonly collation: string | null;
            readonly hourCycle: string | null;
            readonly numberingSystem: string | null;
            readonly numeric: boolean;
            maximize(): Locale;
            minimize(): Locale;
            toString(): string;
        }
        
        var Locale: {
            new(tag: string | string[], options?: LocaleOptions): Locale;
            (tag: string | string[], options?: LocaleOptions): Locale;
        };
    }
}

// Intl API: Segmenter types
declare global {
    namespace Intl {
        type Granularity = "grapheme" | "word" | "sentence";
        
        interface SegmenterOptions {
            localeMatcher?: "lookup" | "best fit";
            granularity?: Granularity;
        }
        
        interface Segment {
            readonly segment: string;
            readonly index: number;
            readonly input: string;
            readonly isWordLike: boolean;
        }
        
        interface Segments {
            readonly [Symbol.iterator](): IterableIterator<Segment>;
            containing(index: number): Segment | undefined;
        }
        
        interface Segmenter {
            segment(input: string): Segments;
            resolvedOptions(): ResolvedSegmenterOptions;
        }
        
        var Segmenter: {
            new(locales?: string | string[], options?: SegmenterOptions): Segmenter;
            supportedLocalesOf(locales: string | string[], options?: SegmenterOptions): string[];
        };
    }
}

// Node.js global types
declare global {
    namespace NodeJS {
        interface EventEmitter {
            addListener(event: string | symbol, listener: (...args: any[]) => void): this;
            on(event: string | symbol, listener: (...args: any[]) => void): this;
            once(event: string | symbol, listener: (...args: any[]) => void): this;
            removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
            off(event: string | symbol, listener: (...args: any[]) => void): this;
            removeAllListeners(event?: string | symbol): this;
            setMaxListeners(n: number): this;
            getMaxListeners(): number;
            listeners(event: string | symbol): Function[];
            rawListeners(event: string | symbol): Function[];
            emit(event: string | symbol, ...args: any[]): boolean;
            listenerCount(event: string | symbol): number;
            prependListener(event: string | symbol, listener: (...args: any[]) => void): this;
            prependOnceListener(event: string | symbol, listener: (...args: any[]) => void): this;
            eventNames(): (string | symbol)[];
        }
        
        interface ReadableStream {
            read(size?: number): any;
            setEncoding(encoding: BufferEncoding): this;
            pause(): this;
            resume(): this;
            pipe<T extends WritableStream>(destination: T, options?: { end?: boolean }): T;
            unpipe(destination?: WritableStream): this;
            unshift(chunk: any, encoding?: BufferEncoding): void;
            wrap(oldStream: ReadableStream): this;
            [Symbol.asyncIterator](): AsyncIterableIterator<any>;
        }
        
        interface WritableStream {
            write(chunk: any, cb?: (err: Error | null) => void): boolean;
            write(chunk: any, encoding: BufferEncoding, cb?: (err: Error | null) => void): boolean;
            end(cb?: () => void): void;
            end(chunk: any, cb?: () => void): void;
            end(chunk: any, encoding: BufferEncoding, cb?: () => void): void;
            cork(): void;
            uncork(): void;
        }
    }
}

// NodeJS specific global types
declare global {
    namespace NodeJS {
        interface Timeout {
            ref(): this;
            unref(): this;
            hasRef(): boolean;
        }
        
        interface Immediate {
            ref(): this;
            unref(): this;
            hasRef(): boolean;
            _onImmediate: Function;
        }
        
        interface Require {
            (id: string): any;
            resolve: RequireResolve;
            cache: Dict<any>;
            extensions: NodeRequireExtensions;
            main: Module | undefined;
        }
        
        interface RequireResolve {
            (id: string, options?: { paths?: string[] }): string;
            paths(request: string): string[] | null;
        }
        
        interface Module {
            exports: any;
            require: Require;
            id: string;
            filename: string;
            loaded: boolean;
            parent: Module | null;
            children: Module[];
            paths: string[];
        }
        
        type Dict<T> = { [key: string]: T | undefined };
        type ReadonlyDict<T> = { readonly [key: string]: T | undefined };
    }
}

// NodeJS ErrnoException types
declare global {
    namespace NodeJS {
        interface ErrnoException extends Error {
            errno?: number;
            code?: string;
            path?: string;
            syscall?: string;
            stack?: string;
        }
        
        interface TypedArray extends ArrayBufferView {}
        interface ArrayBufferView {
            buffer: ArrayBuffer;
            byteLength: number;
            byteOffset: number;
        }
        
        interface CallSite {
            getThis(): any;
            getTypeName(): string | null;
            getFunction(): Function | undefined;
            getFunctionName(): string | null;
            getMethodName(): string | null;
            getFileName(): string | null;
            getLineNumber(): number | null;
            getColumnNumber(): number | null;
            getEvalOrigin(): string | undefined;
            isToplevel(): boolean;
            isEval(): boolean;
            isNative(): boolean;
            isConstructor(): boolean;
        }
    }
}

// Buffer global types
declare global {
    const Buffer: {
        new(size: number): Buffer;
        new(str: string, encoding?: BufferEncoding): Buffer;
        new(buffer: Buffer): Buffer;
        isBuffer(obj: any): obj is Buffer;
        from(array: number[]): Buffer;
        from(arrayBuffer: ArrayBuffer, byteOffset?: number, length?: number): Buffer;
        from(buffer: Buffer): Buffer;
        from(data: any, encoding?: BufferEncoding): Buffer;
        from(string: string, encoding?: BufferEncoding): Buffer;
        alloc(size: number, fill?: string | Buffer | number, encoding?: BufferEncoding): Buffer;
        allocUnsafe(size: number): Buffer;
        allocUnsafeSlow(size: number): Buffer;
        byteLength(string: string, encoding?: BufferEncoding): number;
        compare(buf1: Buffer, buf2: Buffer): number;
        concat(list: Buffer[], totalLength?: number): Buffer;
        isEncoding(encoding: string): encoding is BufferEncoding;
        poolSize: number;
    };
}

// process global types
declare global {
    namespace NodeJS {
        interface ProcessEnv {
            [key: string]: string | undefined;
        }
        
        interface ProcessRelease {
            name: string;
            sourceUrl?: string;
            headersUrl?: string;
            libUrl?: string;
            lts?: string;
        }
        
        interface ProcessVersions {
            node: string;
            bun: string;
            v8: string;
            uv: string;
            zlib: string;
            brotli: string;
            ares: string;
            modules: string;
            openssl: string;
        }
        
        interface HRTime {
            (time?: number[]): [number, number];
        }
        
        interface CpuUsage {
            user: number;
            system: number;
        }
        
        interface MemoryUsage {
            rss: number;
            heapTotal: number;
            heapUsed: number;
            external: number;
            arrayBuffers: number;
        }
    }
    
    var process: NodeJS.Process;
}

// global global type
declare global {
    var global: typeof globalThis;
    
    interface Global {
        Array: typeof Array;
        ArrayBuffer: typeof ArrayBuffer;
        BigInt: typeof BigInt;
        BigInt64Array: typeof BigInt64Array;
        Boolean: typeof Boolean;
        DataView: typeof DataView;
        Date: typeof Date;
        Error: typeof Error;
        EvalError: typeof EvalError;
        Float32Array: typeof Float32Array;
        Float64Array: typeof Float64Array;
        Function: typeof Function;
        Int8Array: typeof Int8Array;
        Int16Array: typeof Int16Array;
        Int32Array: typeof Int32Array;
        Map: typeof Map;
        NaN: number;
        Infinity: number;
        undefined: any;
        Number: typeof Number;
        Object: typeof Object;
        Promise: typeof Promise;
        RangeError: typeof RangeError;
        ReferenceError: typeof ReferenceError;
        RegExp: typeof RegExp;
        Set: typeof Set;
        String: typeof String;
        Symbol: typeof Symbol;
        SyntaxError: typeof SyntaxError;
        TypeError: typeof TypeError;
        Uint8Array: typeof Uint8Array;
        Uint8ClampedArray: typeof Uint8ClampedArray;
        Uint16Array: typeof Uint16Array;
        Uint32Array: typeof Uint32Array;
        URIError: typeof URIError;
        WeakMap: typeof WeakMap;
        WeakSet: typeof WeakSet;
        decodeURI: (encodedURI: string) => string;
        decodeURIComponent: (encodedURIComponent: string) => string;
        encodeURI: (uri: string) => string;
        encodeURIComponent: (uriComponent: string) => string;
        eval: (x: string) => any;
        isFinite: (number: number) => boolean;
        isNaN: (number: number) => boolean;
        parseFloat: (string: string) => number;
        parseInt: (string: string, radix?: number) => number;
    }
}

// queueMicrotask global type
declare global {
    function queueMicrotask(callback: () => void): void;
    
    function clearImmediate(immediateId: NodeJS.Immediate): void;
    function setImmediate(callback: (...args: any[]) => void, ...args: any[]): NodeJS.Immediate;
    
    function clearInterval(intervalId: NodeJS.Timeout): void;
    function clearTimeout(timeoutId: NodeJS.Timeout): void;
    function setInterval(callback: (...args: any[]) => void, ms: number, ...args: any[]): NodeJS.Timeout;
    function setTimeout(callback: (...args: any[]) => void, ms: number, ...args: any[]): NodeJS.Timeout;
}

// StructuredClone global type
declare global {
    function structuredClone<T>(value: T, options?: StructuredSerializeOptions): T;
    
    interface StructuredSerializeOptions {
        transfer?: any[];
    }
}

// Text types
declare global {
    function escape(str: string): string;
    function unescape(str: string): string;
}

// NodeJS Platform types
declare global {
    namespace NodeJS {
        type Platform = "aix" | "darwin" | "freebsd" | "linux" | "openbsd" | "sunos" | "win32" | "android";
        
        interface Architecture {
            [index: number]: string;
            "x64": string;
            "arm": string;
            "arm64": string;
            "ia32": string;
            "mips": string;
            "mipsel": string;
            "ppc": string;
            "ppc64": string;
            "s390": string;
            "s390x": string;
            "x86": string;
        }
        
        const platform: Platform;
        const arch: string;
    }
}

// Signals types
declare global {
    namespace NodeJS {
        type Signals = "SIGABRT" | "SIGALRM" | "SIGBUS" | "SIGCHLD" | "SIGCONT" | "SIGFPE" | "SIGHUP" | "SIGILL" | "SIGINT" | "SIGIO" | "SIGIOT" | "SIGKILL" | "SIGPIPE" | "SIGPOLL" | "SIGPROF" | "SIGPWR" | "SIGQUIT" | "SIGSEGV" | "SIGSTKFLT" | "SIGSTOP" | "SIGSYS" | "SIGTERM" | "SIGTRAP" | "SIGTSTP" | "SIGTTIN" | "SIGTTOU" | "SIGURG" | "SIGUSR1" | "SIGUSR2" | "SIGVTALRM" | "SIGWINCH" | "SIGXCPU" | "SIGXFSZ" | "SIGBREAK" | "SIGLOST" | "SIGINFO";
    }
}

// NodeJS constants types
declare global {
    namespace NodeJS {
        const constants: {
            UV_UDP_REUSEADDR: number;
            signals: Record<string, number>;
            errno: Record<string, number>;
            windows: Record<string, number> | null;
            priority: Record<string, number>;
        };
    }
}

// BOM types
declare global {
    const COM: any;
    const JAVA: any;
    const SYSTEM: any;
    const SUN: any;
    const CLASS: any;
    const COUNTER: any;
    const DEBUG: any;
    const ERRNO: any;
    const FLAG: any;
    const FRAMES: any;
    const STACK: any;
    const LOAD: any;
    const NATIVE: any;
    const OP: any;
    const PROP: any;
    const TAG: any;
}

// JS types
declare global {
    const $: any;
    const $$: any;
    const $$$: any;
    const $A: any;
    const $F: any;
    const $H: any;
    const $R: any;
    const $w: any;
}

// Web Worker types
declare global {
    class WorkerEventMap extends EventMap {
        message: MessageEvent;
        messageerror: MessageEvent;
        error: ErrorEvent;
    }
    
    interface WorkerEventHandlers extends EventHandlers {
        onmessage: (this: Worker, event: MessageEvent) => void;
        onmessageerror: (this: Worker, event: MessageEvent) => void;
        onerror: (this: Worker, event: ErrorEvent) => void;
    }
}

// Test types
declare global {
    namespace test {
        interface TestContext {
            [key: string]: any;
        }
        
        interface TestOptions {
            only?: boolean;
            skip?: boolean;
            todo?: boolean;
            timeout?: number;
        }
        
        interface DescribeOptions {
            only?: boolean;
            skip?: boolean;
            todo?: boolean;
        }
    }
}

// Compression API types
declare module "node:zlib" {
  import { Transform, TransformOptions } from "node:stream";
  
  export interface ZlibOptions extends TransformOptions {
    flush?: number;
    finishFlush?: number;
    chunkSize?: number;
    windowBits?: number;
    level?: number;
    memLevel?: number;
    strategy?: number;
    dictionary?: Buffer | Buffer[] | any;
    info?: boolean;
  }
  
  export interface BrotliOptions extends TransformOptions {
    chunkSize?: number;
    flush?: number;
    finishFlush?: number;
    params?: {
      [key: number]: number;
    };
    maxOutputLength?: number;
  }
  
  export class Zlib extends Transform {
    readonly closed: boolean;
    close(): void;
  }
  
  export class Gzip extends Zlib {
    params(level: number, strategy: number): void;
  }
  
  export class Gunzip extends Zlib {}
  export class Deflate extends Zlib {
    params(level: number, strategy: number): void;
  }
  
  export class Inflate extends Zlib {}
  export class DeflateRaw extends Zlib {
    params(level: number, strategy: number): void;
  }
  
  export class InflateRaw extends Zlib {}
  export class Unzip extends Zlib {}
  
  export class BrotliCompress extends Transform {
    readonly closed: boolean;
    close(): void;
  }
  
  export class BrotliDecompress extends Transform {
    readonly closed: boolean;
    close(): void;
  }
  
  export function createGzip(options?: ZlibOptions): Gzip;
  export function createGunzip(options?: ZlibOptions): Gunzip;
  export function createDeflate(options?: ZlibOptions): Deflate;
  export function createInflate(options?: ZlibOptions): Inflate;
  export function createDeflateRaw(options?: ZlibOptions): DeflateRaw;
  export function createInflateRaw(options?: ZlibOptions): InflateRaw;
  export function createUnzip(options?: ZlibOptions): Unzip;
  export function createBrotliCompress(options?: BrotliOptions): BrotliCompress;
  export function createBrotliDecompress(options?: BrotliOptions): BrotliDecompress;
}

// Path API types
declare module "node:path" {
  export interface PathObject {
    dir: string;
    root: string;
    base: string;
    name: string;
    ext: string;
  }
  
  export function basename(path: string, ext?: string): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
  export function format(pathObject: PathObject): string;
  export function join(...paths: string[]): string;
  export function normalize(path: string): string;
  export function parse(path: string): PathObject;
  export function relative(from: string, to: string): string;
  export function resolve(...pathSegments: string[]): string;
  export const sep: string;
  export const delimiter: string;
  export const win32: typeof import("node:path");
  export const posix: typeof import("node:path");
  export function isAbsolute(path: string): boolean;
  export function toNamespacedPath(path: string): string;
}

// Query String API types
declare module "node:querystring" {
  export interface StringifyOptions {
    encodeURIComponent?: (str: string) => string;
  }
  
  export interface ParseOptions {
    maxKeys?: number;
    decodeURIComponent?: (str: string) => string;
  }
  
  export function stringify(obj: Record<string, any>, options?: StringifyOptions): string;
  export function parse(str: string, options?: ParseOptions): Record<string, any>;
  export function escape(str: string): string;
  export function unescape(str: string): string;
}

// punycode API types (deprecated)
declare module "node:punycode" {
  export function decode(input: string): string;
  export function encode(input: string): string;
  export function toASCII(input: string): string;
  export function toUnicode(input: string): string;
  export const ucs2: {
    decode(input: string): number[];
    encode(codePoints: number[]): string;
  };
  export const version: string;
}

// trace_events API types
declare module "node:trace_events" {
  export interface TracingOptions {
    categories?: string[];
    filename?: string;
  }
  
  export interface Tracing {
    enabled: boolean;
    categories: string[];
    enable(): void;
    disable(): void;
  }
  
  export function createTracing(options?: TracingOptions): Tracing;
}

// string_decoder API types
declare module "node:string_decoder" {
  export interface StringDecoderOptions {
    encoding?: BufferEncoding;
  }
  
  export class StringDecoder {
    constructor(encoding?: BufferEncoding);
    constructor(options?: StringDecoderOptions);
    write(buffer: Buffer): string;
    end(buffer?: Buffer): string;
    readonly encoding: BufferEncoding;
  }
}

// REPL API types
declare module "node:repl" {
  import { Interface as ReadlineInterface } from "node:readline";
  import { Context } from "node:vm";
  import { EventEmitter } from "node:events";
  
  export interface REPLEval {
    (code: string, context: Context, filename: string, callback: (err: Error | null, result: any) => void): any;
  }
  
  export interface ReplOptions {
    prompt?: string;
    input?: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    terminal?: boolean;
    eval?: REPLEval;
    useColors?: boolean;
    useGlobal?: boolean;
    ignoreUndefined?: boolean;
    writer?: (obj: any) => string;
    completer?: any;
    replMode?: any;
    breakEvalOnSigint?: boolean;
    preview?: boolean;
  }
  
  export interface REPLServerAction {
    final: any;
    mid: any;
    err: any;
  }
  
  export interface REPLServer extends ReadlineInterface {
    context: Context;
    readonly input: NodeJS.ReadableStream;
    readonly output: NodeJS.WritableStream;
    readonly terminal: boolean;
    defineCommand(keyword: string, cmd: string | { help: string; action: (this: REPLServer) => void }): void;
    displayPrompt(preserveCursor?: boolean): void;
    clearBufferedCommand(): void;
    parseREPLKeyword(keyword: string, rest: string): REPLServerAction | void;
    setupHistory(path: string, callback: (err: Error | null, repl: this) => void): void;
  }
  
  export function start(options?: ReplOptions): REPLServer;
  export const REPL_MODE_SLOPPY: symbol;
  export const REPL_MODE_STRICT: symbol;
}

// readline API types
declare module "node:readline" {
  import { EventEmitter } from "node:events";
  
  export interface ReadLineOptions {
    input: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    completer?: Completer | AsyncCompleter;
    terminal?: boolean;
    history?: string[];
    historySize?: number;
    prompt?: string;
    crlfDelay?: number;
    removeHistoryDuplicates?: boolean;
    escapeCodeTimeout?: number;
  }
  
  export type Completer = (line: string) => [string[], string];
  export type AsyncCompleter = (line: string, callback: (err?: null | Error, result?: [string[], string]) => void) => void;
  
  export interface Key {
    sequence?: string;
    name?: string;
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
  }
  
  export class Interface extends EventEmitter {
    readonly terminal: boolean;
    prompt(): void;
    pause(): this;
    resume(): this;
    write(data: string | Buffer, key?: Key): void;
    question(query: string, callback: (answer: string) => void): void;
    close(): void;
    readonly line: string;
    readonly cursor: number;
  }
  
  export function createInterface(options: ReadLineOptions): Interface;
}

// cluster API types
declare module "node:cluster" {
  import { EventEmitter } from "node:events";
  import { ChildProcess } from "node:child_process";
  
  export interface ClusterSettings {
    exec?: string;
    args?: string[];
    silent?: boolean;
    execArgv?: string[];
    cwd?: string;
    inspectPort?: number | (() => number);
  }
  
  export interface Worker extends ChildProcess {
    readonly id: number;
    readonly process: ChildProcess;
    send(message: any, sendHandle?: any, options?: any, callback?: (error: Error | null) => void): boolean;
    kill(signal?: string): void;
    disconnect(): void;
    isConnected(): boolean;
    isDead(): boolean;
    exitedAfterDisconnect: boolean;
  }
  
  export interface Cluster extends EventEmitter {
    readonly Worker: typeof Worker;
    readonly workers: Record<number, Worker>;
    readonly isMaster: boolean;
    readonly isWorker: boolean;
    readonly settings: ClusterSettings;
    readonly worker?: Worker;
    readonly id?: number;
    fork(env?: any): Worker;
    disconnect(callback?: () => void): void;
    setupMaster(settings?: ClusterSettings): void;
    schedulingPolicy: number;
    settings: ClusterSettings;
  }
  
  export const SCHED_NONE: number;
  export const SCHED_RR: number;
  
  const cluster: Cluster;
  export default cluster;
}

// dgram API types
declare module "node:dgram" {
  import { EventEmitter } from "node:events";
  import { AddressInfo } from "node:net";
  
  export interface RemoteInfo {
    address: string;
    family: "IPv4" | "IPv6";
    port: number;
    size: number;
  }
  
  export interface BindOptions {
    port?: number;
    address?: string;
    exclusive?: boolean;
    fd?: number;
  }
  
  export class Socket extends EventEmitter {
    readonly type: "udp4" | "udp6";
    send(
      msg: Buffer | string | Uint8Array,
      port: number,
      address?: string,
      callback?: (error: Error | null, bytes: number) => void
    ): void;
    send(
      msg: Buffer | string | Uint8Array,
      offset: number,
      length: number,
      port: number,
      address?: string,
      callback?: (error: Error | null, bytes: number) => void
    ): void;
    bind(port?: number, address?: string, callback?: () => void): this;
    bind(options: BindOptions, callback?: () => void): this;
    close(callback?: () => void): void;
    address(): AddressInfo | string;
    setBroadcast(flag: boolean): void;
    setTTL(ttl: number): void;
    setMulticastTTL(ttl: number): void;
    setMulticastInterface(multicastInterface: string): void;
    setMulticastLoopback(flag: boolean): void;
    addMembership(multicastAddress: string, multicastInterface?: string): void;
    dropMembership(multicastAddress: string, multicastInterface?: string): void;
    ref(): this;
    unref(): this;
  }
  
  export function createSocket(type: "udp4" | "udp6", callback?: (msg: Buffer, rinfo: RemoteInfo) => void): Socket;
}

// diagnostics_channel API types
declare module "node:diagnostics_channel" {
  import { EventEmitter } from "node:events";
  
  export interface Channel extends EventEmitter {
    readonly name: string;
    hasSubscribers(): boolean;
    publish<T>(value: T): boolean;
  }
  
  export function channel(name: string): Channel;
  export function hasSubscribers(name: string): boolean;
}

// async_hooks API types
declare module "node:async_hooks" {
  export interface AsyncResourceOptions {
    triggerAsyncId?: number;
    requireManualDestroy?: boolean;
  }
  
  export interface HookCallbacks {
    init(asyncId: number, type: string, triggerAsyncId: number, resource: object): void;
    before(asyncId: number): void;
    after(asyncId: number): void;
    destroy(asyncId: number): void;
    promiseResolve(asyncId: number): void;
  }
  
  export interface AsyncHook {
    enable(): this;
    disable(): this;
  }
  
  export class AsyncResource {
    constructor(type: string, options?: AsyncResourceOptions);
    readonly asyncId: number;
    readonly triggerAsyncId: number;
    emitBefore(asyncId: number, type: string, triggerAsyncId: number): void;
    emitAfter(asyncId: number): void;
    emitDestroy(): void;
    asyncId(): number;
    triggerAsyncId(): number;
    runInAsyncScope<This, Result>(fn: (this: This) => Result, thisArg?: This, ...args: any[]): Result;
    runInAsyncScope<This, Result>(fn: (this: This, ...args: any[]) => Result, thisArg?: This, ...args: any[]): Result;
    bindToCurrentContext(): this;
  }
  
  export function createHook(callbacks: HookCallbacks): AsyncHook;
  export function executionAsyncResource(): object;
  export function executionAsyncId(): number;
  export function triggerAsyncId(): number;
}

// worker_threads API types
declare module "node:worker_threads" {
  import { EventEmitter } from "node:events";
  
  export interface WorkerOptions {
    eval?: boolean;
    filename?: string;
    workerData?: any;
    stdin?: boolean;
    stdout?: boolean;
    stderr?: boolean;
    env?: Record<string, string>;
    execArgv?: string[];
    resourceLimits?: ResourceLimits;
    argv?: string[];
    trackUnmanagedFds?: boolean;
  }
  
  export interface ResourceLimits {
    maxYoungGenerationSizeMb?: number;
    maxOldGenerationSizeMb?: number;
    codeRangeSizeMb?: number;
  }
  
  export interface WorkerPerformance {
    duration: number;
    nodeStartTime: number;
  }
  
  export class MessagePort extends EventEmitter {
    postMessage(value: any, transferList?: any[]): void;
    start(): void;
    close(): void;
    ref(): void;
    unref(): void;
    setMaxListeners(n: number): this;
    getMaxListeners(): number;
  }
  
  export class MessageChannel {
    readonly port1: MessagePort;
    readonly port2: MessagePort;
  }
  
  export class Worker extends EventEmitter {
    readonly stdin: any;
    readonly stdout: any;
    readonly stderr: any;
    readonly threadId: number;
    readonly resourceLimits?: ResourceLimits;
    postMessage(value: any, transferList?: any[]): void;
    terminate(): Promise<number>;
  }
}

// vm API types
declare module "node:vm" {
  export interface Context extends any {}
  
  export interface RunningCodeOptions {
    filename?: string;
    lineOffset?: number;
    columnOffset?: number;
    displayErrors?: boolean;
    timeout?: number;
    breakOnSigint?: boolean;
  }
  
  export interface CompileOptions extends RunningCodeOptions {
    produceCachedData?: boolean;
    cachedData?: Buffer;
  }
  
  export interface ScriptOptions extends CompileOptions {
    filename?: string;
    columnOffset?: number;
    lineOffset?: number;
  }
  
  export interface CreateContextOptions {
    name?: string;
    origin?: string;
    codeGeneration?: {
      strings?: boolean;
      wasm?: boolean;
    };
  }
  
  export interface MeasureMemoryOptions {
    mode?: "summary" | "detailed";
  }
  
  export interface MeasureMemory {
    memory: MeasureMemoryMemoryUsage;
  }
  
  export interface MeasureMemoryMemoryUsage {
    total: {
      jsMemoryEstimate: number;
      jsMemoryRange: [number, number];
    };
  }
  
  export class Script {
    constructor(code: string, options?: ScriptOptions);
    runInContext(contextifiedObject: Context, options?: RunningCodeOptions): any;
    runInNewContext(sandbox?: Context, options?: RunningCodeOptions): any;
    runInThisContext(options?: RunningCodeOptions): any;
    createCachedData(): Buffer;
    cachedDataProduced?: boolean;
    cachedDataRejected?: boolean;
    cachedData?: Buffer;
    sourceMapURL?: string;
  }
  
  export function createContext(sandbox?: Context, options?: CreateContextOptions): Context;
  export function isContext(sandbox: Context): boolean;
  export function runInContext(code: string, contextifiedObject: Context, options?: RunningCodeOptions): any;
  export function runInNewContext(code: string, sandbox?: Context, options?: RunningCodeOptions): any;
  export function runInThisContext(code: string, options?: RunningCodeOptions): any;
  export function compileFunction(code: string, params?: string[], options?: CompileOptions): Function;
}

// inspector API types
declare module "node:inspector" {
  import { EventEmitter } from "node:events";
  
  export class Console {
    constructor();
    log(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
    dir(object: any, options?: any): void;
    time(label?: string): void;
    timeEnd(label?: string): void;
    trace(): void;
    assert(expression: any, ...args: any[]): void;
  }
  
  export class Session extends EventEmitter {
    connect(): void;
    connect(mainSession: Session): void;
    disconnect(): void;
    post(method: string, params?: any, callback?: (err: Error | null, result: any) => void): void;
    post(method: string, callback?: (err: Error | null, result: any) => void): void;
  }
  
  export function open(port?: number, host?: string, wait?: boolean): void;
  export function url(): string;
  export const console: Console;
}

// stream/consumers API types
declare module "node:stream/consumers" {
  export function buffer(stream: NodeJS.ReadableStream): Promise<Buffer>;
  export function text(stream: NodeJS.ReadableStream): Promise<string>;
  export function arrayBuffer(stream: NodeJS.ReadableStream): Promise<ArrayBuffer>;
  export function json(stream: NodeJS.ReadableStream): Promise<any>;
}

// stream/promises API types
declare module "node:stream/promises" {
  export interface FinishedOptions {
    error?: boolean;
    readable?: boolean;
    writable?: boolean;
  }
  
  export interface PipelineOptions {
    end?: boolean;
    signal?: AbortSignal;
  }
  
  export function finished(stream: NodeJS.ReadableStream | NodeJS.WritableStream | NodeJS.ReadWriteStream, options?: FinishedOptions): Promise<void>;
  export function pipeline(...streams: Array<NodeJS.ReadableStream | NodeJS.WritableStream | any>): Promise<any>;
}

// timers/promises API types
declare module "node:timers/promises" {
  export interface Abortable {
    signal: AbortSignal;
  }
  
  export interface TimerOptions extends Abortable {
    ref?: boolean;
  }
  
  export function setTimeout(ms: number, value?: any): Promise<void>;
  export function setTimeout(ms: number, value: any, options: TimerOptions): Promise<void>;
  export function setImmediate(value?: any): Promise<void>;
  export function setImmediate(value: any, options: TimerOptions): Promise<void>;
  export function setInterval(ms: number, value?: any): AsyncIterable<any>;
}

// readline/promises API types
declare module "node:readline/promises" {
  import { Interface as ReadlineInterface } from "node:readline";
  
  export interface ReadLineOptions {
    input: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    completer?: Completer | AsyncCompleter;
    terminal?: boolean;
    history?: string[];
    historySize?: number;
    prompt?: string;
    crlfDelay?: number;
    removeHistoryDuplicates?: boolean;
    escapeCodeTimeout?: number;
  }
  
  export type Completer = (line: string) => [string[], string];
  export type AsyncCompleter = (line: string) => Promise<[string[], string]>;
  
  export class Interface extends ReadlineInterface {
    question(query: string): Promise<string>;
  }
  
  export function createInterface(options: ReadLineOptions): Interface;
}

// domain API types (deprecated)
declare module "node:domain" {
  import { EventEmitter } from "node:events";
  
  export class Domain extends EventEmitter {
    readonly members: any[];
    run(fn: Function): void;
    add(emitter: EventEmitter): void;
    remove(emitter: EventEmitter): void;
    bind(fn: Function): Function;
    intercept(fn: Function): Function;
    enter(): void;
    exit(): void;
  }
  
  export function create(): Domain;
}

// constants API types
declare module "node:constants" {
  export const EE_SEP: string;
  export const ERROR_PURGE_CUTOFF: number;
  export const SSL_OP_ALL: number;
  export const SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION: number;
  export const SSL_OP_CIPHER_SERVER_PREFERENCE: number;
  export const SSL_OP_CISCO_ANYCONNECT: number;
  export const SSL_OP_COOKIE_EXCHANGE: number;
  export const SSL_OP_CRYPTOPRO_TLSEXT_BUG: number;
  export const SSL_OP_DONT_INSERT_EMPTY_FRAGMENTS: number;
  export const SSL_OP_EPHEMERAL_RSA: number;
  export const SSL_OP_LEGACY_SERVER_CONNECT: number;
  export const SSL_OP_MICROSOFT_BIG_SSLV3_BUFFER: number;
  export const SSL_OP_MICROSOFT_SESS_ID_BUG: number;
  export const SSL_OP_MSIE_SSLV2_RSA_PADDING: number;
  export const SSL_OP_NETSCAPE_CA_DN_BUG: number;
  export const SSL_OP_NETSCAPE_CHALLENGE_BUG: number;
  export const SSL_OP_NETSCAPE_DEMO_CIPHER_CHANGE_BUG: number;
  export const SSL_OP_NETSCAPE_REUSE_CIPHER_CHANGE_BUG: number;
  export const SSL_OP_NO_CLIENT_RENEGOTIATION: number;
  export const SSL_OP_NO_COMPRESSION: number;
  export const SSL_OP_NO_QUERY_MTU: number;
  export const SSL_OP_NO_RENEGOTIATION: number;
  export const SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION: number;
  export const SSL_OP_NO_SSLv2: number;
  export const SSL_OP_NO_SSLv3: number;
  export const SSL_OP_NO_TICKET: number;
  export const SSL_OP_NO_TLSv1: number;
  export const SSL_OP_NO_TLSv1_1: number;
  export const SSL_OP_NO_TLSv1_2: number;
  export const SSL_OP_NO_TLSv1_3: number;
  export const SSL_OP_PKCS1_CHECK_1: number;
  export const SSL_OP_PKCS1_CHECK_2: number;
  export const SSL_OP_PRIORITIZE_CHACHA: number;
  export const SSL_OP_SINGLE_DH_USE: number;
  export const SSL_OP_SINGLE_ECDH_USE: number;
  export const SSL_OP_SSLEAY_080_CLIENT_DH_BUG: number;
  export const SSL_OP_SSLREF2_REUSE_CERT_TYPE_BUG: number;
  export const SSL_OP_TLS_BLOCK_PADDING_BUG: number;
  export const SSL_OP_TLS_D5_BUG: number;
  export const SSL_OP_TLS_ROLLBACK_BUG: number;
}

// perf_hooks API types
declare module "node:perf_hooks" {
  export interface PerformanceEntry {
    readonly name: string;
    readonly entryType: string;
    readonly startTime: number;
    readonly duration: number;
    readonly kind?: number;
  }
  
  export interface PerformanceEntryEntrylist {
    getEntries(): PerformanceEntry[];
    getEntriesByName(name: string, type?: string): PerformanceEntry[];
    getEntriesByType(type: string): PerformanceEntry[];
  }
  
  export interface PerformanceNodeTiming extends PerformanceEntry {
    readonly bootstrapComplete: number;
    readonly environment: number;
    readonly idleTime: number;
    readonly loopStart: number;
    const loopExit?: number;
    readonly v8Start: number;
  }
  
  export interface Performance {
    readonly nodeTiming: PerformanceNodeTiming;
    now(): number;
    clearMarks(name?: string): void;
    clearMeasures(name?: string): void;
    getEntries(): PerformanceEntry[];
    getEntriesByName(name: string, type?: string): PerformanceEntry[];
    getEntriesByType(type: string): PerformanceEntry[];
    mark(name: string): void;
    measure(name: string, startMarkOrMeasure: string, endMarkOrMeasure?: string): void;
  }
  
  export function createHistogram(): PerformanceHistogram;
}

// v8 API types
declare module "node:v8" {
  export interface HeapSpaceStatistics {
    space_name: string;
    space_size: number;
    space_used_size: number;
    space_available_size: number;
    physical_space_size: number;
  }
  
  export interface HeapCodeStatistics {
    code_and_metadata_size: number;
    bytecode_and_metadata_size: number;
    external_script_source_size: number;
  }
  
  export interface HeapSnapshotOptions {
    exposeInternals?: boolean;
    exposeNumericValues?: boolean;
  }
  
  export interface SerializeDeserializeOptions {
    serialization?: any;
  }
  
  export function writeHeapSnapshot(heapSnapshotOptions?: HeapSnapshotOptions): string;
  export function getHeapStatistics(): HeapStatistics;
  export function getHeapSpaceStatistics(): HeapSpaceStatistics[];
  export function getHeapCodeStatistics(): HeapCodeStatistics;
  export function setFlagsFromString(flags: string): void;
  export function serialize(value: any): Buffer;
  export function deserialize(buffer: Buffer): any;
}

// os API types
declare module "node:os" {
  export interface CpuInfo {
    model: string;
    speed: number;
    times: {
      user: number;
      nice: number;
      sys: number;
      idle: number;
      irq: number;
    };
  }
  
  export interface NetworkInterfaceBase {
    address: string;
    netmask: string;
    mac: string;
    internal: boolean;
    cidr: string | null;
  }
  
  export interface NetworkInterfaceInfoIPv4 extends NetworkInterfaceBase {
    family: "IPv4";
  }
  
  export interface NetworkInterfaceInfoIPv6 extends NetworkInterfaceBase {
    family: "IPv6";
    scopeid: number;
  }
  
  export type NetworkInterfaceInfo = NetworkInterfaceInfoIPv4 | NetworkInterfaceInfoIPv6;
  
  export interface UserInfo<T = string> {
    username: T;
    uid: number;
    gid: number;
    shell: T;
    homedir: T;
  }
  
  export function hostname(): string;
  export function loadavg(): number[];
  export function uptime(): number;
  export function freemem(): number;
  export function totalmem(): number;
  export function cpus(): CpuInfo[];
  export function type(): string;
  export function release(): string;
  export function networkInterfaces(): Record<string, NetworkInterfaceInfo[]>;
  export function homedir(): string;
  export function tmpdir(): string;
  export function userInfo(options?: { encoding: BufferEncoding }): UserInfo<string>;
  export const constants: {
    UV_UDP_REUSEADDR: number;
    signals: Record<string, number>;
    errno: Record<string, number>;
    windows: Record<string, number> | null;
    priority: Record<string, number>;
  };
}

// crypto additional API types
declare module "node:crypto" {
  export interface CipherOptions {
    authTagLength?: number;
  }
  
  export interface BinaryLike {}
  export interface CipherKey {}
  
  export class Cipher {
    update(data: BinaryLike): Buffer;
    update(data: BinaryLike, inputEncoding: BufferEncoding, outputEncoding: BufferEncoding): string;
    update(data: BinaryLike, inputEncoding: BufferEncoding): Buffer;
    final(): Buffer;
    final(outputEncoding: BufferEncoding): string;
    setAutoPadding(autoPadding?: boolean): this;
    getAuthTag(): Buffer;
    setAuthTag(buffer: Buffer): void;
  }
  
  export class Decipher {
    update(data: BinaryLike): Buffer;
    update(data: BinaryLike, inputEncoding: BufferEncoding, outputEncoding: BufferEncoding): string;
    update(data: BinaryLike, inputEncoding: BufferEncoding): Buffer;
    final(): Buffer;
    final(outputEncoding: BufferEncoding): string;
    setAuthTag(buffer: Buffer): void;
    setAutoPadding(autoPadding?: boolean): this;
  }
  
  export class Hash {
    update(data: BinaryLike): Hash;
    update(data: BinaryLike, encoding: BufferEncoding): Hash;
    digest(): Buffer;
    digest(encoding: BufferEncoding): string;
  }
  
  export class Hmac extends Hash {}
  
  export class Sign {
    update(data: BinaryLike): Sign;
    update(data: BinaryLike, encoding: BufferEncoding): Sign;
    sign(privateKey: CipherKey): Buffer;
    sign(privateKey: CipherKey, outputFormat: BufferEncoding): string;
  }
  
  export class Verify {
    update(data: BinaryLike): Verify;
    update(data: BinaryLike, encoding: BufferEncoding): Verify;
    verify(object: CipherKey, signature: BinaryLike): boolean;
    verify(object: CipherKey, signature: BinaryLike, signatureFormat: BufferEncoding): boolean;
  }
  
  export function createCipher(algorithm: string, password: BinaryLike): Cipher;
  export function createDecipher(algorithm: string, password: BinaryLike): Decipher;
  export function createHash(algorithm: string): Hash;
  export function createHmac(algorithm: string, key: CipherKey): Hmac;
  export function createSign(algorithm: string): Sign;
  export function createVerify(algorithm: string): Verify;
}

// events additional API types
declare module "node:events" {
  export interface EventEmitterOptions {
    captureRejections?: boolean;
  }
  
  export interface EventEmitterAsyncResource extends EventEmitter {
    asyncResource: any;
    asyncId: number;
    triggerAsyncId: number;
  }
  
  export interface NodeEventTarget {
    once(eventName: string | symbol, listener: (...args: any[]) => void): this;
  }
  
  export interface DOMEventTarget {
    addEventListener(eventName: string, listener: (...args: any[]) => void, opts?: any): any;
    removeEventListener(eventName: string, listener: (...args: any[]) => void, opts?: any): any;
  }
  
  export function on(emitter: EventEmitter, eventName: string): AsyncIterableIterator<any>;
  export function once(emitter: NodeEventTarget, eventName: string | symbol): Promise<any[]>;
  export function once(emitter: DOMEventTarget, eventName: string): Promise<any[]>;
  export function getEventListeners(emitter: EventEmitter | DOMEventTarget, name: string | symbol): Function[];
  export function getMaxListeners(emitter: EventEmitter | DOMEventTarget): number;
  export function listenerCount(emitter: EventEmitter, eventName: string | symbol): number;
}

// util additional API types
declare module "node:util" {
  export function format(format?: any, ...param: any[]): string;
  export function formatWithOptions(inspectOptions: any, format?: any, ...param: any[]): string;
  export function inspect(object: any, options?: any): string;
  export function isArray(value: any): value is any[];
  export function isBoolean(value: any): value is boolean;
  export function isNull(value: any): value is null;
  export function isNullOrUndefined(value: any): value is null | undefined;
  export function isNumber(value: any): value is number;
  export function isString(value: any): value is string;
  export function isSymbol(value: any): value is symbol;
  export function isUndefined(value: any): value is undefined;
  export function isObject(value: any): value is object;
  export function isError(e: any): e is Error;
  export function isFunction(value: any): value is Function;
  export function isRegExp(value: any): value is RegExp;
  export function isPrimitive(value: any): boolean;
  export function isBuffer(value: any): value is Buffer;
  export function isDeepStrictEqual(val1: any, val2: any): boolean;
  export function promisify<T>(fn: Function): T;
  export function callbackify(fn: Function): Function;
  export const types: {
    isAnyArrayBuffer(value: any): value is ArrayBuffer;
    isArrayBufferView(value: any): value is any;
    isArgumentsObject(value: any): boolean;
    isBigInt64Array(value: any): value is BigInt64Array;
    isBigUint64Array(value: any): value is BigUint64Array;
    isBooleanObject(value: any): value is Boolean;
    isBoxedPrimitive(value: any): boolean;
    isDataView(value: any): value is DataView;
    isDate(value: any): value is Date;
    isFloat32Array(value: any): value is Float32Array;
    isFloat64Array(value: any): value is Float64Array;
    isGeneratorFunction(value: any): value is GeneratorFunction;
    isGeneratorObject(value: any): boolean;
    isInt8Array(value: any): value is Int8Array;
    isInt16Array(value: any): value is Int16Array;
    isInt32Array(value: any): value is Int32Array;
    isMap(value: any): value is Map<any, any>;
    isMapIterator(value: any): boolean;
    isModuleNamespaceObject(value: any): boolean;
    isNativeError(value: any): value is Error;
    isNumberObject(value: any): value is Number;
    isPromise(value: any): value is Promise<any>;
    isProxy(value: any): boolean;
    isRegExp(value: any): value is RegExp;
    isSet(value: any): value is Set<any>;
    isSetIterator(value: any): boolean;
    isSharedArrayBuffer(value: any): value is SharedArrayBuffer;
    isStringObject(value: any): value is String;
    isSymbolObject(value: any): value is Symbol;
    isTypedArray(value: any): value is any;
    isUint8Array(value: any): value is Uint8Array;
    isUint8ClampedArray(value: any): value is Uint8ClampedArray;
    isUint16Array(value: any): value is Uint16Array;
    isUint32Array(value: any): value is Uint32Array;
    isWeakMap(value: any): value is WeakMap<any, any>;
    isWeakSet(value: any): value is WeakSet<any>;
  };
}

// assert API types
declare module "node:assert" {
  export interface AssertionErrorOptions {
    message?: string;
    actual?: any;
    expected?: any;
    operator?: string;
    stackStartFn?: Function;
  }
  
  export class AssertionError extends Error {
    actual: any;
    expected: any;
    operator: string;
    generatedMessage: boolean;
    code: string;
  }
  
  export class CallTracker {
    calls(func: Function, specifics?: any): Function;
    report(): CallTrackerReportInformation[];
    reset(): void;
    verify(): void;
  }
  
  export interface CallTrackerReportInformation {
    message: string;
    actual: number;
    expected: number;
    operator: string;
    stack: Function;
  }
  
  export function assert(value: any, message?: string | Error): asserts value;
  export function fail(message?: string | Error): never;
  export function ok(value: any, message?: string | Error): asserts value;
  export function equal(actual: any, expected: any, message?: string | Error): void;
  export function notEqual(actual: any, expected: any, message?: string | Error): void;
  export function deepEqual(actual: any, expected: any, message?: string | Error): void;
  export function notDeepEqual(actual: any, expected: any, message?: string | Error): void;
  export function strictEqual(actual: any, expected: any, message?: string | Error): void;
  export function notStrictEqual(actual: any, expected: any, message?: string | Error): void;
  export function deepStrictEqual(actual: any, expected: any, message?: string | Error): void;
  export function notDeepStrictEqual(actual: any, expected: any, message?: string | Error): void;
  export function match(value: string, regexp: RegExp, message?: string | Error): void;
  export function doesNotMatch(value: string, regexp: RegExp, message?: string | Error): void;
  export function throws(block: Function, message?: string | Error): void;
  export function throws(block: Function, error: RegExp | Function | any, message?: string | Error): void;
  export function doesNotThrow(block: Function, message?: string | Error): void;
  export function ifError(value: any): void;
  export function rejects(block: Function | Promise<any>, message?: string | Error): Promise<void>;
  export function rejects(block: Function | Promise<any>, error: RegExp | Function | any, message?: string | Error): Promise<void>;
  export function doesNotReject(block: Function | Promise<any>, message?: string | Error): Promise<void>;
}

// path/posix API types
declare module "node:path/posix" {
  export interface PathObject {
    dir: string;
    root: string;
    base: string;
    name: string;
    ext: string;
  }
  
  export function basename(path: string, ext?: string): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
  export function format(pathObject: PathObject): string;
  export function join(...paths: string[]): string;
  export function normalize(path: string): string;
  export function parse(path: string): PathObject;
  export function relative(from: string, to: string): string;
  export function resolve(...pathSegments: string[]): string;
  export const sep: string;
  export const delimiter: string;
  export function isAbsolute(path: string): boolean;
  export function toNamespacedPath(path: string): string;
}

// path/win32 API types
declare module "node:path/win32" {
  export interface PathObject {
    dir: string;
    root: string;
    base: string;
    name: string;
    ext: string;
  }
  
  export function basename(path: string, ext?: string): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
  export function format(pathObject: PathObject): string;
  export function join(...paths: string[]): string;
  export function normalize(path: string): string;
  export function parse(path: string): PathObject;
  export function relative(from: string, to: string): string;
  export function resolve(...pathSegments: string[]): string;
  export const sep: string;
  export const delimiter: string;
  export function isAbsolute(path: string): boolean;
  export function toNamespacedPath(path: string): string;
}

// fs additional API types
declare module "node:fs" {
  export interface StatsBase<T> {
    isFile(): boolean;
    isDirectory(): boolean;
    isBlockDevice(): boolean;
    isCharacterDevice(): boolean;
    isSymbolicLink(): boolean;
    isFIFO(): boolean;
    isSocket(): boolean;
    dev: T;
    ino: T;
    mode: T;
    nlink: T;
    uid: T;
    gid: T;
    rdev: T;
    size: T;
    blksize: T;
    blocks: T;
    atimeMs: T;
    mtimeMs: T;
    ctimeMs: T;
    birthtimeMs: T;
    atime: Date;
    mtime: Date;
    ctime: Date;
    birthtime: Date;
  }
  
  export interface Stats extends StatsBase<number> {}
  
  export interface BigIntStats extends StatsBase<bigint> {}
  
  export interface OpenOptions {
    flags?: string | number;
    mode?: number;
    fs?: any;
  }
  
  export interface OpenDirOptions {
    encoding?: BufferEncoding | null;
    bufferSize?: number;
  }
  
  export interface ReadSyncOptions {
    buffer?: Buffer;
    offset?: number;
    length?: number;
    position?: number;
  }
}

// net additional API types
declare module "node:net" {
  export interface SocketAddressOpts {
    host?: string;
    port?: number;
    flowlabel?: number;
  }
  
  export interface LookupFunction {
    (hostname: string, options: LookupAllOptions, callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void): void;
    (hostname: string, options: LookupOneOptions, callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void): void;
    (hostname: string, options: LookupOptions, callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void): void;
    (hostname: string, callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void): void;
  }
  
  export interface LookupOptions extends LookupOneOptions, LookupAllOptions {}
  
  export interface LookupOneOptions {
    family?: number;
    hints?: number;
  }
  
  export interface LookupAllOptions {
    all: true;
    family?: number;
    hints?: number;
  }
  
  export interface LookupAddress {
    address: string;
    family: number;
  }
  
  export interface TcpSocketConnectOpts {
    port: number;
    host?: string;
    localAddress?: string;
    localPort?: number;
    family?: number;
    hints?: number;
    lookup?: LookupFunction;
    noDelay?: boolean;
    keepAlive?: boolean;
    keepAliveInitialDelay?: number;
  }
  
  export interface IpcSocketConnectOpts {
    path: string;
  }
  
  export type SocketConnectOpts = TcpSocketConnectOpts | IpcSocketConnectOpts;
}

// http additional API types
declare module "node:http" {
  export interface ServerOptions {
    IncomingMessage?: typeof IncomingMessage;
    ServerResponse?: typeof ServerResponse;
    maxHeaderSize?: number;
    insecureHTTPParser?: boolean;
    keepAliveTimeout?: number;
    headersTimeout?: number;
    requestTimeout?: number;
  }
  
  export interface RequestOptions {
    method?: string;
    headers?: any;
    auth?: string;
    protocol?: string;
    host?: string;
    hostname?: string;
    port?: number;
    path?: string;
    agent?: any;
    defaultPort?: number;
    family?: number;
    lookup?: any;
    timeout?: number;
    setHost?: boolean;
    createConnection?: any;
  }
}

// https additional API types
declare module "node:https" {
  import { RequestOptions } from "node:http";
  import { Server as HttpServer } from "node:http";
  import { TLSSocket } from "node:tls";
  
  export interface ServerOptions {
    pfx?: string | Buffer | string[] | Buffer[] | any[];
    key?: string | Buffer | string[] | Buffer[] | any[];
    passphrase?: string;
    cert?: string | Buffer | string[] | Buffer[];
    ca?: string | Buffer | string[] | Buffer[];
    ciphers?: string;
    honorCipherOrder?: boolean;
    ecdhCurve?: string;
    clientCertEngine?: string;
    crl?: string | string[] | Buffer | Buffer[];
    dhparam?: string | Buffer;
    secureProtocol?: string;
    secureOptions?: number;
    sessionTimeout?: number;
    ticketKeys?: Buffer;
    sessionIdContext?: string;
    requestCert?: boolean;
    rejectUnauthorized?: boolean;
    NPNProtocols?: string[] | Buffer[] | Uint8Array[] | Buffer;
    ALPNProtocols?: string[] | Buffer[] | Uint8Array[] | Buffer;
    SNICallback?: (servername: string, cb: (err: Error | null, ctx?: any) => void) => void;
  }
  
  export interface RequestOptions extends RequestOptions {
    pfx?: string | Buffer | string[] | Buffer[] | any[];
    key?: string | Buffer | string[] | Buffer[] | any[];
    passphrase?: string;
    cert?: string | Buffer | string[] | Buffer[];
    ca?: string | Buffer | string[] | Buffer[];
    ciphers?: string;
    honorCipherOrder?: boolean;
    ecdhCurve?: string;
    clientCertEngine?: string;
    crl?: string | string[] | Buffer | Buffer[];
    dhparam?: string | Buffer;
    secureProtocol?: string;
    secureOptions?: number;
    sessionTimeout?: number;
    ticketKeys?: Buffer;
    sessionIdContext?: string;
    rejectUnauthorized?: boolean;
    NPNProtocols?: string[] | Buffer[] | Uint8Array[] | Buffer;
    ALPNProtocols?: string[] | Buffer[] | Uint8Array[] | Buffer;
    SNICallback?: (servername: string, cb: (err: Error | null, ctx?: any) => void) => void;
    servername?: string;
    checkServerIdentity?: (hostname: string, cert: any) => Error | undefined;
    minDHSize?: number;
    agent?: any;
  }
}

// http2 additional API types
declare module "node:http2" {
  export interface ServerOptions {
    maxDeflateDynamicTableSize?: number;
    maxSessionMemory?: number;
    maxHeaderListPairs?: number;
    maxOutstandingPings?: number;
    maxSendHeaderBlockLength?: number;
    maxConcurrentStreams?: number;
    settings?: any;
    onSessionHandlers?: any;
  }
  
  export interface SessionOptions {
    maxDeflateDynamicTableSize?: number;
    maxSessionMemory?: number;
    maxHeaderListPairs?: number;
    maxOutstandingPings?: number;
    maxSendHeaderBlockLength?: number;
    settings?: any;
  }
  
  export interface ClientSessionOptions extends SessionOptions {
    maxReservedRemoteStreams?: number;
    createConnection?: any;
  }
  
  export interface ClientOptions extends ClientSessionOptions {
    protocol?: string;
    authority?: string;
  }
  
  export interface StatOptions {
    offset?: number;
    length?: number;
  }
}

// child_process additional API types
declare module "node:child_process" {
  import { EventEmitter } from "node:events";
  import { Readable, Writable } from "node:stream";
  
  export interface ChildProcess extends EventEmitter {
    readonly stdin: Writable | null;
    readonly stdout: Readable | null;
    readonly stderr: Readable | null;
    readonly readonly stdin: Readable | null;
    readonly readonly stdout: Readable | null;
    readonly readonly stderr: Readable | null;
    readonly pid: number;
    readonly connected: boolean;
    readonly exitCode: number | null;
    readonly signalCode: NodeJS.Signals | null;
    readonly spawnargs: string[];
    readonly spawnfile: string;
    kill(signal?: NodeJS.Signals | number): boolean;
    send(message: any, sendHandle?: any, options?: any, callback?: (error: Error | null) => void): boolean;
    disconnect(): void;
    unref(): void;
    ref(): void;
  }
  
  export interface SpawnOptions {
    cwd?: string;
    env?: Record<string, string>;
    argv0?: string;
    stdio?: any;
    detached?: boolean;
    shell?: boolean | string;
    uid?: number;
    gid?: number;
    windowsHide?: boolean;
    windowsVerbatimArguments?: boolean;
  }
  
  export interface SpawnOptionsWithStdioTuple<Stdin, Stdout, Stderr> extends SpawnOptions {
    stdio: [Stdin, Stdout, Stderr];
  }
  
  export interface ExecOptions extends SpawnOptions {
    shell?: string;
    maxBuffer?: number;
    killSignal?: NodeJS.Signals | number;
    timeout?: number;
  }
  
  export interface ExecSyncOptions extends ExecOptions {
    input?: string | Buffer;
    encoding?: BufferEncoding;
  }
  
  export interface ForkOptions extends SpawnOptions {
    silent?: boolean;
    execPath?: string;
    execArgv?: string[];
  }
}

// module additional API types
declare module "node:module" {
  export interface Module extends NodeModule {}
  
  export interface ModuleNamespace {
    [key: string]: any;
  }
  
  export interface SourceMap {
    file: string;
    sourceRoot: string;
    sources: string[];
    sourcesContent: string[];
    names: string[];
    mappings: string;
    version: number;
  }
  
  export function createRequire(path: string | URL): NodeRequire;
  export function createRequireFromPath(path: string): NodeRequire;
  export function syncBuiltinESMExports(): void;
  export function isBuiltin(moduleName: string): boolean;
  export function register(specifier: string | URL, parentURL?: string | URL): void;
}

// url additional API types
declare module "node:url" {
  export interface UrlObject {
    protocol?: string | null;
    slashes?: boolean | null;
    auth?: string | null;
    host?: string | null;
    port?: string | number | null;
    hostname?: string | null;
    hash?: string | null;
    search?: string | null;
    query?: string | null | any;
    pathname?: string | null;
    path?: string | null;
    href?: string | null;
  }
  
  export interface Url {
    protocol: string | null;
    slashes: boolean | null;
    auth: string | null;
    host: string | null;
    port: string | null;
    hostname: string | null;
    hash: string | null;
    search: string | null;
    query: string | null | any;
    pathname: string | null;
    path: string | null;
    href: string;
  }
  
  export interface ParseOptions {
    decodeQueryString?: boolean;
  }
  
  export interface FormatOptions {
    auth?: boolean;
    fragment?: boolean;
    search?: boolean;
    unicode?: boolean;
  }
  
  export function parse(url: string, parseQueryString?: boolean, slashesDenoteHost?: boolean): Url;
  export function format(urlObject: UrlObject | string, options?: FormatOptions): string;
  export function resolve(from: string, to: string): string;
  export function resolveObject(from: string, to: string): Url;
  export function domainToASCII(domain: string): string;
  export function domainToUnicode(domain: string): string;
  export function pathToFileURL(path: string): URL;
  export function fileURLToPath(url: string | URL): string;
}

// DNS additional API types
declare module "node:dns" {
  export interface LookupOptions {
    family?: number;
    hints?: number;
    all?: boolean;
    verbatim?: boolean;
  }
  
  export interface LookupOneAddress {
    address: string;
    family: number;
  }
  
  export interface LookupAllAddresses {
    address: string;
    family: number;
  }
  
  export interface RecordWithTtl {
    address: string;
    ttl: number;
  }
  
  export interface AnyRecord {
    type: string;
    value: any;
  }
  
  export interface ResolveOptions {
    ttl?: boolean;
  }
  
  export interface ResolveWithTtlOptions extends ResolveOptions {
    ttl: true;
  }
  
  export interface ResolverOptions {
    timeout?: number;
    tries?: number;
  }
}

// stream additional API types
declare module "node:stream" {
  export interface ReadableOptions {
    highWaterMark?: number;
    encoding?: BufferEncoding;
    objectMode?: boolean;
    read?: (this: Readable, size: number) => void;
    destroy?: (this: Readable, error: Error | null, callback: (error: Error | null) => void) => void;
  }
  
  export interface WritableOptions {
    highWaterMark?: number;
    decodeStrings?: boolean;
    defaultEncoding?: BufferEncoding;
    objectMode?: boolean;
    emitClose?: boolean;
    write?: (this: Writable, chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void) => boolean;
    writev?: (this: Writable, chunks: Array<{ chunk: any; encoding: BufferEncoding }>, callback: (error?: Error | null) => void) => boolean;
    destroy?: (this: Writable, error: Error | null, callback: (error: Error | null) => void) => void;
    final?: (this: Writable, callback: (error?: Error | null) => void) => void;
  }
  
  export interface DuplexOptions extends ReadableOptions, WritableOptions {
    allowHalfOpen?: boolean;
    readableObjectMode?: boolean;
    writableObjectMode?: boolean;
  }
  
  export interface TransformOptions extends DuplexOptions {
    transform?: (this: Transform, chunk: any, encoding: BufferEncoding, callback: TransformCallback) => void;
    flush?: (this: Transform, callback: TransformCallback) => void;
  }
  
  export type TransformCallback = (error?: Error | null, data?: any) => void;
}

// process additional API types
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      [key: string]: string | undefined;
    }
    
    interface ProcessRelease {
      name: string;
      sourceUrl?: string;
      headersUrl?: string;
      libUrl?: string;
      lts?: string;
    }
    
    interface ProcessVersions {
      node: string;
      bun: string;
      v8: string;
      uv: string;
      zlib: string;
      brotli: string;
      ares: string;
      modules: string;
      openssl: string;
    }
    
    interface ProcessReport {
      writeReport(fileName?: string, err?: Error): string;
      getReport(err?: Error): string;
      directory: string;
      filename: string;
      compact: boolean;
      triggerReport(signal: string, filename?: string): boolean;
      onSignal(signal: string): void;
    }
    
    interface Process extends EventEmitter {
      report?: ProcessReport;
      allowedNodeEnvironmentFlags: Set<string>;
      arch: string;
      argv: string[];
      argv0: string;
      config: any;
      connected: boolean;
      debugPort: number;
      env: ProcessEnv;
      execArgv: string[];
      execPath: string;
      exitCode: number;
      mainModule?: Module;
      noDeprecation: boolean;
      pid: number;
      ppid: number;
      platform: NodeJS.Platform;
      release: ProcessRelease;
      title: string;
      version: string;
      versions: ProcessVersions;
    }
  }
}

// buffer additional API types
declare module "node:buffer" {
  export interface BufferConstructor {
    alloc(size: number): Buffer;
    alloc(size: number, fill: string, encoding?: BufferEncoding): Buffer;
    alloc(size: number, fill: number): Buffer;
    alloc(size: number, fill: Buffer): Buffer;
    allocUnsafe(size: number): Buffer;
    allocUnsafeSlow(size: number): Buffer;
    byteLength(string: string | Buffer | ArrayBufferView | ArrayBuffer | SharedArrayBuffer, encoding?: BufferEncoding): number;
    compare(a: Buffer, b: Buffer): number;
    concat(list: Buffer[], totalLength?: number): Buffer;
    from(array: number[]): Buffer;
    from(arrayBuffer: ArrayBuffer | SharedArrayBuffer, byteOffset?: number, length?: number): Buffer;
    from(buffer: Buffer): Buffer;
    from(data: any, encoding?: BufferEncoding): Buffer;
    from(string: string, encoding?: BufferEncoding): Buffer;
    isBuffer(obj: any): obj is Buffer;
    isEncoding(encoding: string): encoding is BufferEncoding;
    poolSize: number;
  }
  
  export const Buffer: BufferConstructor;
  
  export const constants: {
    MAX_LENGTH: number;
    MAX_STRING_LENGTH: number;
  };
  
  export const INSPECT_MAX_BYTES: number;
}

// console additional API types
declare module "console" {
  interface Console {
    assert(condition: boolean, ...data: any[]): void;
    clear(): void;
    count(label?: string): void;
    countReset(label?: string): void;
    debug(...data: any[]): void;
    dir(item?: any, options?: any): void;
    dirxml(...data: any[]): void;
    error(...data: any[]): void;
    group(...data: any[]): void;
    groupCollapsed(...data: any[]): void;
    groupEnd(): void;
    info(...data: any[]): void;
    log(...data: any[]): void;
    table(tabularData?: any, properties?: string[]): void;
    time(label?: string): void;
    timeEnd(label?: string): void;
    timeLog(label?: string, ...data: any[]): void;
    timeStamp(label?: string): void;
    trace(...data: any[]): void;
    warn(...data: any[]): void;
  }
}

// bun:test additional API types
declare module "bun:test" {
  export interface TestContext {
    [key: string]: any;
  }
  
  export interface TestOptions {
    only?: boolean;
    skip?: boolean;
    todo?: boolean;
    timeout?: number;
  }
  
  export interface DescribeOptions {
    only?: boolean;
    skip?: boolean;
    todo?: boolean;
  }
}

// Web globals additional types
declare global {
  function atob(data: string): string;
  function btoa(data: string): string;
  
  function setTimeout(handler: TimerHandler, timeout?: number, ...arguments: any[]): number;
  function setInterval(handler: TimerHandler, timeout?: number, ...arguments: any[]): number;
  function clearTimeout(timeoutId: number): void;
  function clearInterval(intervalId: number): void;
  function queueMicrotask(callback: Function): void;
  
  type TimerHandler = string | Function;
  
  function structuredClone<T>(value: T, options?: StructuredSerializeOptions): T;
  
  interface StructuredSerializeOptions {
    transfer?: any[];
  }
  
  var console: Console;
}

// Fetch API additional types
declare global {
  interface RequestInit {
    method?: string;
    headers?: any;
    body?: BodyInit | null;
    referrer?: string;
    referrerPolicy?: ReferrerPolicy;
    mode?: RequestMode;
    credentials?: RequestCredentials;
    redirect?: RequestRedirect;
    integrity?: string;
    keepalive?: boolean;
    signal?: AbortSignal | null;
    window?: null;
  }
  
  interface ResponseInit {
    status?: number;
    statusText?: string;
    headers?: any;
  }
  
  type RequestMode = "navigate" | "same-origin" | "no-cors" | "cors";
  type RequestCredentials = "omit" | "same-origin" | "include";
  type RequestRedirect = "follow" | "error" | "manual";
  type ReferrerPolicy = "" | "no-referrer" | "no-referrer-when-downgrade" | "same-origin" | "origin" | "strict-origin" | "origin-when-cross-origin" | "strict-origin-when-cross-origin" | "unsafe-url";
}

// Headers additional types
declare global {
  class Headers {
    constructor(init?: HeadersInit);
    append(name: string, value: string): void;
    delete(name: string): void;
    get(name: string): string | null;
    has(name: string): boolean;
    set(name: string, value: string): void;
    forEach(callback: (value: string, key: string, parent: Headers) => void, thisArg?: any): void;
    entries(): IterableIterator<[string, string]>;
    keys(): IterableIterator<string>;
    values(): IterableIterator<string>;
    readonly [Symbol.iterator](): IterableIterator<[string, string]>;
  }
  
  type HeadersInit = Headers | string[][] | Record<string, string>;
}

// FormData additional types
declare global {
  class FormData {
    constructor(form?: HTMLFormElement);
    append(name: string, value: string | Blob, fileName?: string): void;
    delete(name: string): void;
    get(name: string): FormDataEntryValue | null;
    getAll(name: string): FormDataEntryValue[];
    has(name: string): boolean;
    set(name: string, value: string | Blob, fileName?: string): void;
    forEach(callback: (value: FormDataEntryValue, key: string, parent: FormData) => void, thisArg?: any): void;
    entries(): IterableIterator<[string, FormDataEntryValue]>;
    keys(): IterableIterator<string>;
    values(): IterableIterator<FormDataEntryValue>;
    readonly [Symbol.iterator](): IterableIterator<[string, FormDataEntryValue]>;
  }
  
  type FormDataEntryValue = File | string;
}

// File and Blob additional types
declare global {
  class File extends Blob {
    constructor(fileBits: BlobPart[], fileName: string, options?: FilePropertyBag);
    readonly lastModified: number;
    readonly name: string;
  }
  
  interface FilePropertyBag extends BlobPropertyBag {
    lastModified?: number;
  }
  
  type BlobPart = Buffer | Blob | string;
  
  interface BlobPropertyBag {
    type?: string;
    endings?: "transparent" | "native";
  }
  
  class Blob {
    constructor(blobParts?: BlobPart[], options?: BlobPropertyBag);
    readonly size: number;
    readonly type: string;
    arrayBuffer(): Promise<ArrayBuffer>;
    bytes(): Promise<Uint8Array>;
    slice(start?: number, end?: number, contentType?: string): Blob;
    stream(): ReadableStream;
    text(): Promise<string>;
  }
}

// AbortController additional types
declare global {
  class AbortController {
    constructor();
    readonly signal: AbortSignal;
    abort(reason?: any): void;
  }
  
  interface AbortSignalEventMap {
    abort: any;
  }
  
  interface AbortSignal extends EventTarget {
    readonly aborted: boolean;
    readonly reason: any;
    onabort: ((this: AbortSignal, ev: Event) => any) | null;
    throwIfAborted(): void;
  }
  
  var AbortSignal: {
    prototype: AbortSignal;
    new(): AbortSignal;
    abort(reason?: any): AbortSignal;
    timeout(ms: number): AbortSignal;
  };
}

// EventTarget additional types
declare global {
  class EventTarget {
    constructor();
    addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void;
    dispatchEvent(event: Event): boolean;
    removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void;
  }
  
  interface EventListenerOptions {
    capture?: boolean;
  }
  
  interface AddEventListenerOptions extends EventListenerOptions {
    once?: boolean;
    passive?: boolean;
    signal?: AbortSignal;
  }
  
  interface EventListener {
    (evt: Event): void;
  }
  
  interface EventListenerObject {
    handleEvent(object: Event): void;
  }
  
  type EventListenerOrEventListenerObject = EventListener | EventListenerObject;
}

// ReadableStream additional types
declare global {
  interface ReadableStreamDefaultController<T> {
    readonly desiredSize: number | null;
    close(): void;
    enqueue(chunk: T): void;
    error(e?: any): void;
  }
  
  interface ReadableStreamDefaultReader<R> {
    readonly closed: Promise<undefined>;
    cancel(reason?: any): Promise<void>;
    read(): Promise<ReadableStreamReadResult<R>>;
    releaseLock(): void;
  }
  
  type ReadableStreamReadResult<T> = ReadableStreamReadValueResult<T> | ReadableStreamReadDoneResult;
  
  interface ReadableStreamReadValueResult<T> {
    done: false;
    value: T;
  }
  
  interface ReadableStreamReadDoneResult {
    done: true;
    value?: undefined;
  }
}

// WritableStream additional types
declare global {
  interface WritableStreamDefaultController {
    error(e?: any): void;
  }
  
  interface WritableStreamDefaultWriter {
    readonly closed: Promise<undefined>;
    readonly desiredSize: number | null;
    readonly ready: Promise<undefined>;
    abort(reason?: any): Promise<void>;
    close(): Promise<void>;
    releaseLock(): void;
    write(chunk: any): Promise<void>;
  }
  
  interface UnderlyingSinkAbortCallback {
    (reason: any): Promise<void> | void;
  }
  
  interface UnderlyingSinkCloseCallback {
    (): Promise<void> | void;
  }
  
  interface UnderlyingSinkStartCallback {
    (controller: WritableStreamDefaultController): any;
  }
  
  interface UnderlyingSinkWriteCallback<W> {
    (chunk: W, controller: WritableStreamDefaultController): Promise<void> | void;
  }
}

// TransformStream additional types
declare global {
  interface TransformStreamDefaultController<O> {
    readonly desiredSize: number | null;
    enqueue(chunk: O): void;
    error(reason?: any): void;
    terminate(): void;
  }
  
  interface Transformer<I = any, O = any> {
    start?: TransformerStartCallback<O>;
    transform?: TransformerTransformCallback<I, O>;
    flush?: TransformerFlushCallback<O>;
    readableType?: any;
    writableType?: any;
  }
  
  type TransformerStartCallback<O> = (controller: TransformStreamDefaultController<O>) => void | PromiseLike<void>;
  
  type TransformerTransformCallback<I, O> = (chunk: I, controller: TransformStreamDefaultController<O>) => void | PromiseLike<void>;
  
  type TransformerFlushCallback<O> = (controller: TransformStreamDefaultController<O>) => void | PromiseLike<void>;
  
  interface TransformStreamI<I = any, O = any> {
    readonly readable: ReadableStream<O>;
    readonly writable: WritableStream<I>;
  }
}

// TextEncoder/TextDecoder additional types
declare global {
  class TextEncoder {
    constructor();
    readonly encoding: "utf-8";
    encode(input?: string): Uint8Array;
    encodeInto(input: string, dest: Uint8Array): TextEncoderEncodeIntoResult;
  }
  
  interface TextEncoderEncodeIntoResult {
    read?: number;
    written: number;
  }
  
  class TextDecoder {
    constructor(label?: string, options?: TextDecoderOptions);
    readonly encoding: string;
    readonly fatal: boolean;
    readonly ignoreBOM: boolean;
    decode(input?: Buffer | ArrayBuffer | ArrayBufferView, options?: StreamDecodeOptions): string;
  }
  
  interface TextDecoderOptions {
    fatal?: boolean;
    ignoreBOM?: boolean;
  }
  
  interface StreamDecodeOptions {
    stream?: boolean;
  }
  
  var TextDecoder: {
    prototype: TextDecoder;
    new(label?: string, options?: TextDecoderOptions): TextDecoder;
  };
}

// WebSocket additional types
declare global {
  class WebSocket extends EventTarget {
    constructor(url: string | URL, protocols?: string | string[]);
    readonly binaryType: BinaryType;
    readonly bufferedAmount: number;
    readonly extensions: string;
    onclose: ((this: WebSocket, ev: CloseEvent) => any) | null;
    onerror: ((this: WebSocket, ev: Event) => any) | null;
    onmessage: ((this: WebSocket, ev: MessageEvent) => any) | null;
    onopen: ((this: WebSocket, ev: Event) => any) | null;
    readonly protocol: string;
    readonly readyState: number;
    readonly url: string;
    close(code?: number, reason?: string): void;
    send(data: string | Buffer | ArrayBuffer | ArrayBufferView): void;
    readonly CLOSED: number;
    readonly CLOSING: number;
    CONNECTING: number;
    readonly OPEN: number;
    addEventListener<K extends keyof WebSocketEventMap>(type: K, listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  }
  
  interface WebSocketEventMap {
    close: CloseEvent;
    error: Event;
    message: MessageEvent;
    open: Event;
  }
  
  type BinaryType = "blob" | "arraybuffer";
}

// URL and URLSearchParams additional types
declare global {
  class URL {
    constructor(url: string, base?: string | URL);
    hash: string;
    host: string;
    hostname: string;
    href: string;
    readonly origin: string;
    password: string;
    pathname: string;
    port: string;
    protocol: string;
    search: string;
    readonly searchParams: URLSearchParams;
    username: string;
    toJSON(): string;
    toString(): string;
  }
  
  class URLSearchParams {
    constructor(init?: string[][] | Record<string, string> | string | URLSearchParams);
    append(name: string, value: string): void;
    delete(name: string): void;
    entries(): IterableIterator<[string, string]>;
    forEach(callback: (value: string, key: string, searchParams: this) => void): void;
    get(name: string): string | null;
    getAll(name: string): string[];
    has(name: string): boolean;
    keys(): IterableIterator<string>;
    set(name: string, value: string): void;
    sort(): void;
    toString(): string;
    values(): IterableIterator<string>;
    readonly size: number;
  }
}

// Performance additional types
declare global {
  interface Performance {
    readonly timeOrigin: number;
    clearMarks(markName?: string): void;
    clearMeasures(measureName?: string): void;
    clearResourceTimings(): void;
    getEntries(): PerformanceEntry[];
    getEntriesByName(name: string, type?: string): PerformanceEntry[];
    getEntriesByType(type: string): PerformanceEntry[];
    mark(name: string): void;
    measure(name: string, startMark?: string, endMark?: string): void;
    now(): number;
    setResourceTimingBufferSize(maxSize: number): void;
    toJSON(): any;
  }
  
  interface PerformanceEntry {
    readonly duration: number;
    readonly entryType: string;
    readonly name: string;
    readonly startTime: number;
    toJSON(): any;
  }
  
  interface PerformanceMark extends PerformanceEntry {
    readonly entryType: "mark";
  }
  
  interface PerformanceMeasure extends PerformanceEntry {
    readonly entryType: "measure";
  }
}

// Event additional types
declare global {
  interface Event {
    readonly bubbles: boolean;
    cancelable: boolean;
    readonly composed: boolean;
    currentTarget: EventTarget | null;
    readonly defaultPrevented: boolean;
    readonly eventPhase: number;
    readonly isTrusted: boolean;
    returnValue: boolean;
    readonly srcElement: Element | null;
    readonly target: EventTarget | null;
    readonly timeStamp: number;
    readonly type: string;
    composedPath(): EventTarget[];
    preventDefault(): void;
    stopImmediatePropagation(): void;
    stopPropagation(): void;
    readonly AT_TARGET: number;
    readonly BUBBLING_PHASE: number;
    readonly CAPTURING_PHASE: number;
    readonly NONE: number;
  }
  
  var Event: {
    prototype: Event;
    new(type: string, eventInitDict?: EventInit): Event;
  };
  
  interface EventInit {
    bubbles?: boolean;
    cancelable?: boolean;
    composed?: boolean;
  }
}

// CustomEvent additional types
declare global {
  interface CustomEventInit<T = any> extends EventInit {
    detail?: T;
  }
  
  interface CustomEvent<T = any> extends Event {
    readonly detail: T;
    initCustomEvent(type: string, bubbles?: boolean, cancelable?: boolean, detail?: T): void;
  }
  
  var CustomEvent: {
    prototype: CustomEvent;
    new<T = any>(type: string, eventInitDict?: CustomEventInit<T>): CustomEvent<T>;
  };
}

// ErrorEvent and MessageEvent additional types
declare global {
  interface ErrorEvent extends Event {
    readonly colno: number;
    readonly error: any;
    readonly filename: string;
    readonly lineno: number;
    readonly message: string;
  }
  
  var ErrorEvent: {
    prototype: ErrorEvent;
    new(type: string, eventInitDict?: ErrorEventInit): ErrorEvent;
  };
  
  interface ErrorEventInit extends EventInit {
    colno?: number;
    error?: any;
    filename?: string;
    lineno?: number;
    message?: string;
  }
  
  interface MessageEvent<T = any> extends Event {
    readonly data: T;
    readonly lastEventId: string;
    readonly origin: string;
    readonly ports: MessagePort[] | null;
    readonly source: MessageEventSource | null;
    initMessageEvent(type: string, bubbles?: boolean, cancelable?: boolean, data?: any, origin?: string, lastEventId?: string): void;
  }
  
  var MessageEvent: {
    prototype: MessageEvent;
    new<T = any>(type: string, eventInitDict?: MessageEventInit<T>): MessageEvent<T>;
  };
  
  interface MessageEventInit<T = any> extends EventInit {
    data?: T;
    lastEventId?: string;
    origin?: string;
    ports?: MessagePort[];
    source?: MessageEventSource | null;
  }
  
  type MessageEventSource = Window | MessagePort;
}

// CloseEvent and ProgressEvent additional types
declare global {
  interface CloseEvent extends Event {
    readonly code: number;
    readonly reason: string;
    readonly wasClean: boolean;
  }
  
  var CloseEvent: {
    prototype: CloseEvent;
    new(type: string, eventInitDict?: CloseEventInit): CloseEvent;
  };
  
  interface CloseEventInit extends EventInit {
    code?: number;
    reason?: string;
    wasClean?: boolean;
  }
  
  interface ProgressEvent<T = any> extends Event {
    readonly lengthComputable: boolean;
    readonly loaded: number;
    readonly total: number;
    readonly target: T;
  }
  
  var ProgressEvent: {
    prototype: ProgressEvent;
    new<T = any>(type: string, eventInitDict?: ProgressEventInit<T>): ProgressEvent<T>;
  };
  
  interface ProgressEventInit<T = any> extends EventInit {
    lengthComputable?: boolean;
    loaded?: number;
    total?: number;
  }
}

// atob/btoa additional types
declare global {
  function atob(data: string): string;
  function btoa(data: string): string;
}

// timer additional types
declare global {
  function setTimeout(handler: TimerHandler, timeout?: number, ...arguments: any[]): number;
  function setInterval(handler: TimerHandler, timeout?: number, ...arguments: any[]): number;
  function clearTimeout(timeoutId: number): void;
  function clearInterval(intervalId: number): void;
  function queueMicrotask(callback: Function): void;
  
  type TimerHandler = string | Function;
}

// console additional types
declare global {
  namespace NodeJS {
    interface Console {
      Console: console.ConsoleConstructor;
      assert(value: any, message?: string, ...optionalParams: any[]): void;
      dir(obj: any, options?: any): void;
      error(message?: any, ...optionalParams: any[]): void;
      info(message?: any, ...optionalParams: any[]): void;
      log(message?: any, ...optionalParams: any[]): void;
      time(label?: string): void;
      timeEnd(label?: string): void;
      timeLog(label?: string, ...data: any[]): void;
      trace(message?: any, ...optionalParams: any[]): void;
      warn(message?: any, ...optionalParams: any[]): void;
      debug(message?: any, ...optionalParams: any[]): void;
      clear(): void;
      count(label?: string): void;
      countReset(label?: string): void;
      group(...label: any[]): void;
      groupCollapsed(...label: any[]): void;
      groupEnd(): void;
      table(tabularData?: any, properties?: string[]): void;
    }
  }
  
  var console: Console;
}

// JSON additional types
declare global {
  interface JSON {
    parse(text: string, reviver?: (key: any, value: any) => any): any;
    stringify(value: any, replacer?: (this: any, key: string, value: any) => any, space?: string | number): string | undefined;
    stringify(value: any, replacer?: (number | string)[] | null, space?: string | number): string | undefined;
  }
}

// Math additional types
declare global {
  interface Math {
    E: number;
    LN10: number;
    LN2: number;
    LOG10E: number;
    LOG2E: number;
    PI: number;
    SQRT1_2: number;
    SQRT2: number;
    abs(x: number): number;
    acos(x: number): number;
    acosh(x: number): number;
    asin(x: number): number;
    asinh(x: number): number;
    atan(x: number): number;
    atan2(y: number, x: number): number;
    atanh(x: number): number;
    cbrt(x: number): number;
    ceil(x: number): number;
    clz32(x: number): number;
    cos(x: number): number;
    cosh(x: number): number;
    exp(x: number): number;
    expm1(x: number): number;
    floor(x: number): number;
    fround(x: number): number;
    hypot(...values: number[]): number;
    imul(x: number, y: number): number;
    log(x: number): number;
    log10(x: number): number;
    log1p(x: number): number;
    log2(x: number): number;
    max(...values: number[]): number;
    min(...values: number[]): number;
    pow(x: number, y: number): number;
    random(): number;
    round(x: number): number;
    sign(x: number): number;
    sin(x: number): number;
    sinh(x: number): number;
    sqrt(x: number): number;
    tan(x: number): number;
    tanh(x: number): number;
    trunc(x: number): number;
  }
}

// Reflect additional types
declare global {
  namespace Reflect {
    function apply(target: Function, thisArgument: any, argumentsList: ArrayLike<any>): any;
    function construct(target: Function, argumentsList: ArrayLike<any>, newTarget?: Function): any;
    function defineProperty(target: any, propertyKey: PropertyKey, attributes: PropertyDescriptor): boolean;
    function deleteProperty(target: any, propertyKey: PropertyKey): boolean;
    function get(target: any, propertyKey: PropertyKey, receiver?: any): any;
    function getOwnPropertyDescriptor(target: any, propertyKey: PropertyKey): PropertyDescriptor | undefined;
    function getPrototypeOf(target: any): any;
    function has(target: any, propertyKey: PropertyKey): boolean;
    function isExtensible(target: any): boolean;
    function ownKeys(target: any): Array<PropertyKey>;
    function preventExtensions(target: any): boolean;
    function set(target: any, propertyKey: PropertyKey, value: any, receiver?: any): boolean;
    function setPrototypeOf(target: any, proto: any): boolean;
  }
}

// Symbol additional types
declare global {
  interface Symbol {
    readonly description: string | undefined;
  }
  interface SymbolConstructor {
    (description?: string | number): symbol;
    readonly asyncIterator: symbol;
    readonly hasInstance: symbol;
    readonly isConcatSpreadable: symbol;
    readonly iterator: symbol;
    readonly match: symbol;
    readonly matchAll: symbol;
    readonly replace: symbol;
    readonly search: symbol;
    readonly species: symbol;
    readonly split: symbol;
    readonly toPrimitive: symbol;
    readonly toStringTag: symbol;
    readonly unscopables: symbol;
    for(key: string): symbol;
    keyFor(sym: symbol): string | undefined;
  }
  var Symbol: SymbolConstructor;
}

// Promise additional types
declare global {
  interface PromiseConstructor {
    all<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>[]>;
    race<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>>;
    reject(reason?: any): Promise<never>;
    resolve(): Promise<void>;
    resolve<T>(value: T | PromiseLike<T>): Promise<Awaited<T>>;
    withResolvers<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: any) => void; };
    any<T>(values: Iterable<T | PromiseLike<T>>): Promise<Awaited<T>>;
  }
  var Promise: PromiseConstructor;
}

// Array additional types
declare global {
  interface ArrayConstructor {
    from<T>(arrayLike: ArrayLike<T> | Iterable<T>): T[];
    from<T, U>(arrayLike: ArrayLike<T> | Iterable<T>, mapfn: (v: T, k: number) => U, thisArg?: any): U[];
    of<T>(...items: T[]): T[];
    isArray(arg: any): arg is any[];
  }
  interface Array<T> {
    at(index: number): T | undefined;
    concat(...items: ConcatArray<T>[]): T[];
    concat(...items: (T | ConcatArray<T>)[]): T[];
    copyWithin(target: number, start: number, end?: number): this;
    entries(): IterableIterator<[number, T]>;
    every(callbackfn: (value: T, index: number, array: T[]) => boolean, thisArg?: any): boolean;
    fill(value: T, start?: number, end?: number): this;
    filter(callbackfn: (value: T, index: number, array: T[]) => any, thisArg?: any): T[];
    find(callbackfn: (value: T, index: number, obj: T[]) => boolean, thisArg?: any): T | undefined;
    findIndex(callbackfn: (value: T, index: number, obj: T[]) => boolean, thisArg?: any): number;
    findLast(callbackfn: (value: T, index: number, array: T[]) => boolean, thisArg?: any): T | undefined;
    findLastIndex(callbackfn: (value: T, index: number, array: T[]) => boolean, thisArg?: any): number;
    flat<U>(this: U[][][][][], depth: 4): U[];
    flat<U>(this: U[][][], depth: 3): U[];
    flat<U>(this: U[][], depth: 2): U[];
    flat<U>(this: U[], depth: 1): U[];
    flat<U>(this: U[][], depth?: 1): U[];
    flatMap<U, This>(callback: (this: This, value: T, index: number, array: T[]) => U | ReadonlyArray<U>, thisArg?: This): U[];
    forEach(callbackfn: (value: T, index: number, array: T[]) => void, thisArg?: any): void;
    includes(searchElement: T, fromIndex?: number): boolean;
    indexOf(searchElement: T, fromIndex?: number): number;
    join(separator?: string): string;
    keys(): IterableIterator<number>;
    lastIndexOf(searchElement: T, fromIndex?: number): number;
    map<U>(callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any): U[];
    pop(): T | undefined;
    push(...items: T[]): number;
    reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T;
    reduce(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T;
    reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U;
    reduceRight(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T): T;
    reduceRight(callbackfn: (previousValue: T, currentValue: T, currentIndex: number, array: T[]) => T, initialValue: T): T;
    reduceRight<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U;
    reverse(): T[];
    shift(): T | undefined;
    slice(start?: number, end?: number): T[];
    some(callbackfn: (value: T, index: number, array: T[]) => boolean, thisArg?: any): boolean;
    sort(compareFn?: (a: T, b: T) => number): this;
    splice(start: number, deleteCount?: number, ...items: T[]): T[];
    toLocaleString(): string;
    toString(): string;
    unshift(...items: T[]): number;
    values(): IterableIterator<T>;
  }
}

// Map/Set additional types
declare global {
  interface MapConstructor {
    new(): Map<any, any>;
    new<K, V>(entries?: readonly (readonly [K, V])[] | null): Map<K, V>;
  }
  interface Map<K, V> {
    readonly size: number;
    clear(): void;
    delete(key: K): boolean;
    forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void;
    get(key: K): V | undefined;
    has(key: K): boolean;
    set(key: K, value: V): this;
    entries(): IterableIterator<[K, V]>;
    keys(): IterableIterator<K>;
    values(): IterableIterator<V>;
    [Symbol.iterator](): IterableIterator<[K, V]>;
  }
  interface SetConstructor {
    new(): Set<any>;
    new<T>(values?: readonly T[] | null): Set<T>;
  }
  interface Set<T> {
    readonly size: number;
    add(value: T): this;
    clear(): void;
    delete(value: T): boolean;
    forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void, thisArg?: any): void;
    has(value: T): boolean;
    entries(): IterableIterator<[T, T]>;
    keys(): IterableIterator<T>;
    values(): IterableIterator<T>;
    [Symbol.iterator](): IterableIterator<T>;
  }
  var Map: MapConstructor;
  var Set: SetConstructor;
}

// WeakMap/WeakSet additional types
declare global {
  interface WeakMapConstructor {
    new(): WeakMap<any, any>;
    new<K extends object, V>(entries?: readonly (readonly [K, V])[] | null): WeakMap<K, V>;
  }
  interface WeakMap<K extends object, V> {
    delete(key: K): boolean;
    get(key: K): V | undefined;
    has(key: K): boolean;
    set(key: K, value: V): this;
  }
  interface WeakSetConstructor {
    new(): WeakSet<object>;
    new<T extends object>(values?: readonly T[] | null): WeakSet<T>;
  }
  interface WeakSet<T extends object> {
    add(value: T): this;
    delete(value: T): boolean;
    has(value: T): boolean;
  }
  var WeakMap: WeakMapConstructor;
  var WeakSet: WeakSetConstructor;
}

// String additional types
declare global {
  interface String {
    at(index: number): string | undefined;
    charAt(pos: number): string;
    charCodeAt(index: number): number;
    codePointAt(pos: number): number | undefined;
    concat(...strings: string[]): string;
    endsWith(searchString: string, endPosition?: number): boolean;
    includes(searchString: string, position?: number): boolean;
    indexOf(searchString: string, position?: number): number;
    lastIndexOf(searchString: string, position?: number): number;
    localeCompare(that: string): number;
    match(regexp: string | RegExp): RegExpMatchArray | null;
    matchAll(regexp: RegExp): RegExpStringIterator;
    padEnd(maxLength: number, fillString?: string): string;
    padStart(maxLength: number, fillString?: string): string;
    repeat(count: number): string;
    replace(searchValue: string | RegExp, replaceValue: string): string;
    replace(searchValue: string | RegExp, replaceValue: (substring: string, ...args: any[]) => string): string;
    replaceAll(searchValue: string | RegExp, replaceValue: string): string;
    replaceAll(searchValue: string | RegExp, replaceValue: (substring: string) => string): string;
    search(regexp: string | RegExp): number;
    slice(start?: number, end?: number): string;
    split(separator: string | RegExp, limit?: number): string[];
    startsWith(searchString: string, position?: number): boolean;
    substring(start: number, end?: number): string;
    toLocaleLowerCase(locales?: string | string[]): string;
    toLocaleUpperCase(locales?: string | string[]): string;
    toLowerCase(): string;
    toString(): string;
    toUpperCase(): string;
    trim(): string;
    trimEnd(): string;
    trimStart(): string;
    valueOf(): string;
  }
}

// Number additional types
declare global {
  interface Number {
    toExponential(fractionDigits?: number): string;
    toFixed(fractionDigits?: number): string;
    toLocaleString(locales?: string | string[], options?: Intl.NumberFormatOptions): string;
    toPrecision(precision?: number): string;
    toString(radix?: number): string;
    valueOf(): number;
  }
  interface NumberConstructor {
    (value: any): number;
    readonly EPSILON: number;
    readonly MAX_SAFE_INTEGER: number;
    readonly MAX_VALUE: number;
    readonly MIN_SAFE_INTEGER: number;
    readonly MIN_VALUE: number;
    readonly NaN: number;
    readonly NEGATIVE_INFINITY: number;
    readonly POSITIVE_INFINITY: number;
    isFinite(number: number): boolean;
    isInteger(number: number): boolean;
    isNaN(number: number): boolean;
    isSafeInteger(number: number): boolean;
    parseFloat(string: string): number;
    parseInt(string: string, radix?: number): number;
  }
}

// BigInt additional types
declare global {
  interface BigInt {
    toString(radix?: number): string;
    valueOf(): bigint;
    readonly [Symbol.toStringTag]: "BigInt";
  }
  interface BigIntConstructor {
    (value: bigint | boolean | number | string): bigint;
    readonly prototype: BigInt;
    asIntN(bits: number, bigint: bigint): bigint;
    asUintN(bits: number, bigint: bigint): bigint;
    toString(): string;
  }
  var BigInt: BigIntConstructor;
}

// Object additional types
declare global {
  interface ObjectConstructor {
    assign<T extends object>(target: T, ...sources: any[]): T;
    create(o: object | null): any;
    defineProperties<T>(o: T, properties: PropertyDescriptorMap & ThisType<T>): T;
    defineProperty<T>(o: T, p: PropertyKey, attributes: PropertyDescriptor & ThisType<any>): T;
    entries(o: object): [string, any][];
    freeze<T>(a: T): Readonly<T>;
    getOwnPropertyDescriptor(o: any, p: PropertyKey): PropertyDescriptor | undefined;
    getOwnPropertyNames(o: any): string[];
    getOwnPropertySymbols(o: any): symbol[];
    getPrototypeOf(o: any): any;
    groupBy(items: Iterable<any>, keySelector: (item: any, index: number) => unknown): Record<string, any[]>;
    is(value1: any, value2: any): boolean;
    keys(o: object): string[];
    preventExtensions<T>(a: T): T;
    seal<T>(a: T): T;
    setPrototypeOf(o: any, proto: object | null): any;
    values(o: object): any[];
  }
}

// Date additional types
declare global {
  interface Date {
    toString(): string;
    toDateString(): string;
    toTimeString(): string;
    toLocaleString(locales?: string | string[], options?: Intl.DateTimeFormatOptions): string;
    toLocaleDateString(locales?: string | string[], options?: Intl.DateTimeFormatOptions): string;
    toLocaleTimeString(locales?: string | string[], options?: Intl.DateTimeFormatOptions): string;
    valueOf(): number;
    getTime(): number;
    getFullYear(): number;
    getUTCFullYear(): number;
    getMonth(): number;
    getUTCMonth(): number;
    getDate(): number;
    getUTCDate(): number;
    getDay(): number;
    getUTCDay(): number;
    getHours(): number;
    getUTCHours(): number;
    getMinutes(): number;
    getUTCMinutes(): number;
    getSeconds(): number;
    getUTCSeconds(): number;
    getMilliseconds(): number;
    getUTCMilliseconds(): number;
    getTimezoneOffset(): number;
    setTime(time: number): number;
    setMilliseconds(ms: number): number;
    setUTCMilliseconds(ms: number): number;
    setSeconds(sec: number, ms?: number): number;
    setUTCSeconds(sec: number, ms?: number): number;
    setMinutes(min: number, sec?: number, ms?: number): number;
    setUTCMinutes(min: number, sec?: number, ms?: number): number;
    setHours(hours: number, min?: number, sec?: number, ms?: number): number;
    setUTCHours(hours: number, min?: number, sec?: number, ms?: number): number;
    setDate(date: number): number;
    setUTCDate(date: number): number;
    setMonth(month: number, date?: number): number;
    setUTCMonth(month: number, date?: number): number;
    setFullYear(year: number, month?: number, date?: number): number;
    setUTCFullYear(year: number, month?: number, date?: number): number;
    toUTCString(): string;
    toISOString(): string;
    toJSON(key?: string): string;
  }
}

// RegExp additional types
declare global {
  interface RegExp {
    exec(string: string): RegExpExecArray | null;
    test(string: string): boolean;
    compile(pattern: string, flags?: string): this;
    readonly dotAll: boolean;
    readonly flags: string;
    readonly global: boolean;
    readonly hasIndices: boolean;
    readonly ignoreCase: boolean;
    readonly lastIndex: number;
    readonly multiline: boolean;
    readonly source: string;
    readonly sticky: boolean;
    readonly unicode: boolean;
    readonly unicodeSets: boolean;
    [Symbol.match](string: string): RegExpMatchArray | null;
    [Symbol.matchAll](string: string): RegExpStringIterator;
    [Symbol.replace](string: string, replaceValue: string): string;
    [Symbol.replace](string: string, replaceValue: (substring: string, ...args: any[]) => string): string;
    [Symbol.search](string: string): number;
    [Symbol.split](string: string, limit?: number): string[];
  }
  interface RegExpConstructor {
    (pattern: RegExp | string, flags?: string): RegExp;
    readonly prototype: RegExp;
  }
  var RegExp: RegExpConstructor;
}

// Function additional types
declare global {
  interface Function {
    apply(this: Function, thisArg: any, argArray?: any): any;
    call(this: Function, thisArg: any, ...argArray: any[]): any;
    bind(this: Function, thisArg: any, ...argArray: any[]): any;
    toString(): string;
    readonly prototype: any;
    readonly length: number;
    readonly name: string;
  }
  interface FunctionConstructor {
    (...args: string[]): Function;
    readonly prototype: Function;
  }
  var Function: FunctionConstructor;
}

// Error additional types
declare global {
  interface Error {
    name: string;
    message: string;
    stack?: string;
    cause?: unknown;
  }
  interface ErrorConstructor {
    (message?: string): Error;
    readonly prototype: Error;
  }
  var Error: ErrorConstructor;
  
  interface EvalError extends Error {}
  var EvalError: ErrorConstructor;
  
  interface RangeError extends Error {}
  var RangeError: ErrorConstructor;
  
  interface ReferenceError extends Error {}
  var ReferenceError: ErrorConstructor;
  
  interface SyntaxError extends Error {}
  var SyntaxError: ErrorConstructor;
  
  interface TypeError extends Error {}
  var TypeError: ErrorConstructor;
  
  interface URIError extends Error {}
  var URIError: ErrorConstructor;
}

// TypedArray additional types
declare global {
  interface TypedArray {
    readonly buffer: ArrayBuffer;
    readonly byteLength: number;
    readonly byteOffset: number;
    readonly length: number;
    subarray(begin?: number, end?: number): any;
    at(index: number): number;
    every(callbackfn: (value: number, index: number, array: any) => boolean, thisArg?: any): boolean;
    fill(value: number, start?: number, end?: number): this;
    filter(callbackfn: (value: number, index: number, array: any) => any, thisArg?: any): any;
    find(callbackfn: (value: number, index: number, array: any) => boolean, thisArg?: any): number | undefined;
    findIndex(callbackfn: (value: number, index: number, array: any) => boolean, thisArg?: any): number;
    forEach(callbackfn: (value: number, index: number, array: any) => void, thisArg?: any): void;
    includes(searchElement: number, fromIndex?: number): boolean;
    indexOf(searchElement: number, fromIndex?: number): number;
    join(separator?: string): string;
    lastIndexOf(searchElement: number, fromIndex?: number): number;
    map(callbackfn: (value: number, index: number, array: any) => number, thisArg?: any): any;
    reduce(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: any) => number): number;
    reduce(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: any) => number, initialValue: number): number;
    reduceRight(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: any) => number): number;
    reduceRight(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: any) => number, initialValue: number): number;
    reverse(): this;
    set(array: ArrayLike<number>, offset?: number): void;
    slice(start?: number, end?: number): any;
    some(callbackfn: (value: number, index: number, array: any) => boolean, thisArg?: any): boolean;
    sort(compareFn?: (a: number, b: number) => number): this;
    at(index: number): number;
    toLocaleString(): string;
  }
}

// ArrayBuffer and SharedArrayBuffer additional types
declare global {
  interface ArrayBuffer {
    readonly byteLength: number;
    slice(begin?: number, end?: number): ArrayBuffer;
  }
  interface ArrayBufferConstructor {
    new(byteLength: number): ArrayBuffer;
    isView(arg: any): arg is any;
  }
  var ArrayBuffer: ArrayBufferConstructor;
  
  interface SharedArrayBuffer {
    readonly byteLength: number;
    slice(begin?: number, end?: number): SharedArrayBuffer;
  }
  interface SharedArrayBufferConstructor {
    new(byteLength: number): SharedArrayBuffer;
  }
  var SharedArrayBuffer: SharedArrayBufferConstructor;
}

// DataView additional types
declare global {
  interface DataView {
    readonly buffer: ArrayBuffer;
    readonly byteLength: number;
    readonly byteOffset: number;
    getFloat32(byteOffset: number, littleEndian?: boolean): number;
    getFloat64(byteOffset: number, littleEndian?: boolean): number;
    getInt8(byteOffset: number): number;
    getInt16(byteOffset: number, littleEndian?: boolean): number;
    getInt32(byteOffset: number, littleEndian?: boolean): number;
    getUint8(byteOffset: number): number;
    getUint16(byteOffset: number, littleEndian?: boolean): number;
    getUint32(byteOffset: number, littleEndian?: boolean): number;
    setFloat32(byteOffset: number, value: number, littleEndian?: boolean): void;
    setFloat64(byteOffset: number, value: number, littleEndian?: boolean): void;
    setInt8(byteOffset: number, value: number): void;
    setInt16(byteOffset: number, value: number, littleEndian?: boolean): void;
    setInt32(byteOffset: number, value: number, littleEndian?: boolean): void;
    setUint8(byteOffset: number, value: number): void;
    setUint16(byteOffset: number, value: number, littleEndian?: boolean): void;
    setUint32(byteOffset: number, value: number, littleEndian?: boolean): void;
  }
  interface DataViewConstructor {
    new(buffer: ArrayBuffer | SharedArrayBuffer, byteOffset?: number, byteLength?: number): DataView;
  }
  var DataView: DataViewConstructor;
}

// Int8Array and Uint8Array additional types
declare global {
  interface Int8ArrayConstructor {
    new(length?: number): Int8Array;
    new(array: ArrayLike<number> | ArrayBufferLike): Int8Array;
    new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): Int8Array;
    readonly prototype: Int8Array;
    BYTES_PER_ELEMENT: number;
  }
  var Int8Array: Int8ArrayConstructor;
  
  interface Uint8ArrayConstructor {
    new(length?: number): Uint8Array;
    new(array: ArrayLike<number> | ArrayBufferLike): Uint8Array;
    new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): Uint8Array;
    readonly prototype: Uint8Array;
    BYTES_PER_ELEMENT: number;
  }
  var Uint8Array: Uint8ArrayConstructor;
}

// Uint8ClampedArray and Int16Array additional types
declare global {
  interface Uint8ClampedArrayConstructor {
    new(length?: number): Uint8ClampedArray;
    new(array: ArrayLike<number> | ArrayBufferLike): Uint8ClampedArray;
    new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): Uint8ClampedArray;
    readonly prototype: Uint8ClampedArray;
    BYTES_PER_ELEMENT: number;
  }
  var Uint8ClampedArray: Uint8ClampedArrayConstructor;
  
  interface Int16ArrayConstructor {
    new(length?: number): Int16Array;
    new(array: ArrayLike<number> | ArrayBufferLike): Int16Array;
    new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): Int16Array;
    readonly prototype: Int16Array;
    BYTES_PER_ELEMENT: number;
  }
  var Int16Array: Int16ArrayConstructor;
}

// Uint16Array and Int32Array additional types
declare global {
  interface Uint16ArrayConstructor {
    new(length?: number): Uint16Array;
    new(array: ArrayLike<number> | ArrayBufferLike): Uint16Array;
    new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): Uint16Array;
    readonly prototype: Uint16Array;
    BYTES_PER_ELEMENT: number;
  }
  var Uint16Array: Uint16ArrayConstructor;
  
  interface Int32ArrayConstructor {
    new(length?: number): Int32Array;
    new(array: ArrayLike<number> | ArrayBufferLike): Int32Array;
    new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): Int32Array;
    readonly prototype: Int32Array;
    BYTES_PER_ELEMENT: number;
  }
  var Int32Array: Int32ArrayConstructor;
}

// Uint32Array and Float32Array additional types
declare global {
  interface Uint32ArrayConstructor {
    new(length?: number): Uint32Array;
    new(array: ArrayLike<number> | ArrayBufferLike): Uint32Array;
    new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): Uint32Array;
    readonly prototype: Uint32Array;
    BYTES_PER_ELEMENT: number;
  }
  var Uint32Array: Uint32ArrayConstructor;
  
  interface Float32ArrayConstructor {
    new(length?: number): Float32Array;
    new(array: ArrayLike<number> | ArrayBufferLike): Float32Array;
    new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): Float32Array;
    readonly prototype: Float32Array;
    BYTES_PER_ELEMENT: number;
  }
  var Float32Array: Float32ArrayConstructor;
}

// Float64Array and BigInt64Array additional types
declare global {
  interface Float64ArrayConstructor {
    new(length?: number): Float64Array;
    new(array: ArrayLike<number> | ArrayBufferLike): Float64Array;
    new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): Float64Array;
    readonly prototype: Float64Array;
    BYTES_PER_ELEMENT: number;
  }
  var Float64Array: Float64ArrayConstructor;
  
  interface BigInt64ArrayConstructor {
    new(length?: number): BigInt64Array;
    new(array: ArrayLike<bigint> | ArrayBufferLike): BigInt64Array;
    new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): BigInt64Array;
    readonly prototype: BigInt64Array;
    BYTES_PER_ELEMENT: number;
  }
  var BigInt64Array: BigInt64ArrayConstructor;
}

// BigUint64Array additional types
declare global {
  interface BigUint64ArrayConstructor {
    new(length?: number): BigUint64Array;
    new(array: ArrayLike<bigint> | ArrayBufferLike): BigUint64Array;
    new(buffer: ArrayBufferLike, byteOffset?: number, length?: number): BigUint64Array;
    readonly prototype: BigUint64Array;
    BYTES_PER_ELEMENT: number;
  }
  var BigUint64Array: BigUint64ArrayConstructor;
}

// globalThis properties additional types
declare global {
  var NaN: number;
  var Infinity: number;
  var undefined: any;
  var eval: (x: string) => any;
  var parseInt: (string: string, radix?: number) => number;
  var parseFloat: (string: string) => number;
  var isNaN: (number: number) => boolean;
  var isFinite: (number: number) => boolean;
  var decodeURI: (encodedURI: string) => string;
  var decodeURIComponent: (encodedURIComponent: string) => string;
  var encodeURI: (uri: string) => string;
  var encodeURIComponent: (uriComponent: string) => string;
  var escape: (string: string) => string;
  var unescape: (string: string) => string;
}

// Worker API additional types
declare global {
  class Worker extends EventTarget {
    constructor(url: string | URL, options?: WorkerOptions);
    postMessage(message: any, transfer?: any[]): void;
    terminate(): void;
    onmessage: ((this: Worker, ev: MessageEvent) => any) | null;
    onmessageerror: ((this: Worker, ev: MessageEvent) => any) | null;
    onerror: ((this: Worker, ev: ErrorEvent) => any) | null;
  }
  
  interface WorkerOptions {
    type?: "classic" | "module";
    credentials?: RequestCredentials;
    name?: string;
  }
}

// MessageChannel and MessagePort additional types
declare global {
  class MessageChannel {
    readonly port1: MessagePort;
    readonly port2: MessagePort;
  }
  
  interface MessagePort extends EventTarget {
    postMessage(message: any, transfer?: any[]): void;
    close(): void;
    start(): void;
    onmessage: ((this: MessagePort, ev: MessageEvent) => any) | null;
    onmessageerror: ((this: MessagePort, ev: MessageEvent) => any) | null;
  }
}

// BroadcastChannel additional types
declare global {
  class BroadcastChannel extends EventTarget {
    constructor(name: string);
    readonly name: string;
    postMessage(message: any): void;
    close(): void;
    onmessage: ((this: BroadcastChannel, ev: MessageEvent) => any) | null;
    onmessageerror: ((this: BroadcastChannel, ev: MessageEvent) => any) | null;
  }
}

// Storage API additional types
declare global {
  interface Storage {
    readonly length: number;
    clear(): void;
    getItem(key: string): string | null;
    key(index: number): string | null;
    removeItem(key: string): void;
    setItem(key: string, value: string): void;
  }
  
  var localStorage: Storage;
  var sessionStorage: Storage;
}

// Atomics additional types
declare global {
  namespace Atomics {
    function add(typedArray: BigInt64Array | BigUint64Array, index: number, value: bigint): bigint;
    function add(typedArray: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array, index: number, value: number): number;
    function and(typedArray: BigInt64Array | BigUint64Array, index: number, value: bigint): bigint;
    function and(typedArray: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array, index: number, value: number): number;
    function compareExchange(typedArray: BigInt64Array | BigUint64Array, index: number, expectedValue: bigint, replacementValue: bigint): bigint;
    function compareExchange(typedArray: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array, index: number, expectedValue: number, replacementValue: number): number;
    function exchange(typedArray: BigInt64Array | BigUint64Array, index: number, value: bigint): bigint;
    function exchange(typedArray: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array, index: number, value: number): number;
    function isLockFree(size: number): boolean;
    function load(typedArray: BigInt64Array | BigUint64Array, index: number): bigint;
    function load(typedArray: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array, index: number): number;
    function or(typedArray: BigInt64Array | BigUint64Array, index: number, value: bigint): bigint;
    function or(typedArray: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array, index: number, value: number): number;
    function store(typedArray: BigInt64Array | BigUint64Array, index: number, value: bigint): bigint;
    function store(typedArray: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array, index: number, value: number): number;
    function sub(typedArray: BigInt64Array | BigUint64Array, index: number, value: bigint): bigint;
    function sub(typedArray: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array, index: number, value: number): number;
    function wait(typedArray: Int32Array, index: number, value: number, timeout?: number): "ok" | "not-equal" | "timed-out";
    function waitAsync(typedArray: Int32Array, index: number, value: number, timeout?: number): { async: true; value: Promise<"ok" | "not-equal" | "timed-out">; } | { async: false; value: "ok" | "not-equal" | "timed-out"; };
    function notify(typedArray: Int32Array, index: number, count?: number): number;
    function xor(typedArray: BigInt64Array | BigUint64Array, index: number, value: bigint): bigint;
    function xor(typedArray: Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array, index: number, value: number): number;
  }
}

// FinalizationRegistry and WeakRef additional types
declare global {
  interface FinalizationRegistry {
    unregister(unregisterToken: object): boolean;
  }
  
  interface FinalizationRegistryConstructor {
    new(finalizationCallback: (heldValue: any) => void): FinalizationRegistry;
    prototype: FinalizationRegistry;
  }
  
  var FinalizationRegistry: FinalizationRegistryConstructor;
  
  class WeakRef {
    constructor(target: object);
    deref(): object | undefined;
  }
}

// Iterator and AsyncIterator additional types
declare global {
  interface Iterator {
    next(...args: any[]): IteratorResult;
    return?(value?: any): IteratorResult;
    throw?(e?: any): IteratorResult;
  }
  
  interface IteratorResult<T = any, TReturn = any> {
    done?: boolean;
    value: T | TReturn;
  }
  
  interface Generator extends Iterator {
    next(...args: any[]): IteratorResult;
    return(value: any): IteratorResult;
    throw(e: any): IteratorResult;
    [Symbol.iterator](): Generator;
  }
  
  interface AsyncIterator {
    next(...args: any[]): Promise<IteratorResult>;
    return?(value?: any): Promise<IteratorResult>;
    throw?(e?: any): Promise<IteratorResult>;
  }
  
  interface AsyncGenerator extends AsyncIterator {
    next(...args: any[]): Promise<IteratorResult>;
    return(value: any): Promise<IteratorResult>;
    throw(e: any): Promise<IteratorResult>;
    [Symbol.asyncIterator](): AsyncGenerator;
  }
}

// Generator and AsyncGenerator additional types
declare global {
  interface GeneratorFunction {
    (...args: any[]): Generator;
    readonly prototype: Generator;
    readonly length: number;
    readonly name: string;
  }
  
  var GeneratorFunction: GeneratorFunctionConstructor;
  
  interface GeneratorFunctionConstructor {
    readonly prototype: GeneratorFunction;
    new(...args: string[]): GeneratorFunction;
    (...args: string[]): GeneratorFunction;
  }
  
  interface AsyncGeneratorFunction {
    (...args: any[]): AsyncGenerator;
    readonly prototype: AsyncGenerator;
    readonly length: number;
    readonly name: string;
  }
  
  var AsyncGeneratorFunction: AsyncGeneratorFunctionConstructor;
  
  interface AsyncGeneratorFunctionConstructor {
    readonly prototype: AsyncGeneratorFunction;
    new(...args: string[]): AsyncGeneratorFunction;
    (...args: string[]): AsyncGeneratorFunction;
  }
}

// Proxy additional types
declare global {
  interface ProxyHandler<T extends object> {
    getPrototypeOf?: (target: T) => object | null;
    setPrototypeOf?: (target: T, v: any) => boolean;
    isExtensible?: (target: T) => boolean;
    preventExtensions?: (target: T) => boolean;
    getOwnPropertyDescriptor?: (target: T, p: PropertyKey) => PropertyDescriptor | undefined;
    defineProperty?: (target: T, p: PropertyKey, attributes: PropertyDescriptor) => boolean;
    has?: (target: T, p: PropertyKey) => boolean;
    get?: (target: T, p: PropertyKey, receiver: any) => any;
    set?: (target: T, p: PropertyKey, value: any, receiver: any) => boolean;
    deleteProperty?: (target: T, p: PropertyKey) => boolean;
    ownKeys?: (target: T) => Array<PropertyKey>;
    apply?: (target: T, thisArg: any, argArray: any[]) => any;
    construct?: (target: T, argArray: any[], newTarget: Function) => object;
  }
  
  interface ProxyConstructor {
    revocable<T extends object>(target: T, handler: ProxyHandler<T>): { proxy: T; revoke: () => void; };
    new<T extends object>(target: T, handler: ProxyHandler<T>): T;
  }
  
  var Proxy: ProxyConstructor;
}

// Intl.DateTimeFormat additional types
declare global {
  namespace Intl {
    interface DateTimeFormatOptions {
      formatMatcher?: "basic" | "best fit";
      hour12?: boolean;
      weekday?: "long" | "short" | "narrow";
      era?: "long" | "short" | "narrow";
      year?: "numeric" | "2-digit";
      month?: "numeric" | "2-digit" | "long" | "short" | "narrow";
      day?: "numeric" | "2-digit";
      hour?: "numeric" | "2-digit";
      minute?: "numeric" | "2-digit";
      second?: "numeric" | "2-digit";
      timeZoneName?: "long" | "short";
      formatMatcher?: "basic" | "best fit";
      timeZone?: string;
      calendar?: string;
      numberingSystem?: string;
      localeMatcher?: "lookup" | "best fit";
    }
    
    interface DateTimeFormat {
      format(date?: Date | number): string;
      formatToParts(date?: Date | number): DateTimeFormatPart[];
      resolvedOptions(): ResolvedDateTimeFormatOptions;
    }
    
    var DateTimeFormat: {
      new(locales?: string | string[], options?: DateTimeFormatOptions): DateTimeFormat;
      (locales?: string | string[], options?: DateTimeFormatOptions): string;
      supportedLocalesOf(locales: string | string[], options?: DateTimeFormatOptions): string[];
    };
  }
}

// Intl.NumberFormat additional types
declare global {
  namespace Intl {
    interface NumberFormatOptions {
      localeMatcher?: "lookup" | "best fit";
      style?: "decimal" | "currency" | "percent" | "unit";
      currency?: string;
      currencyDisplay?: "symbol" | "narrowSymbol" | "code" | "name";
      currencySign?: "standard" | "accounting";
      unit?: string;
      unitDisplay?: "short" | "narrow" | "long";
      useGrouping?: boolean;
      minimumIntegerDigits?: number;
      minimumFractionDigits?: number;
      maximumFractionDigits?: number;
      minimumSignificantDigits?: number;
      maximumSignificantDigits?: number;
      notation?: "standard" | "scientific" | "engineering" | "compact";
      compactDisplay?: "short" | "long";
      signDisplay?: "auto" | "always" | "never" | "exceptZero";
    }
    
    interface NumberFormat {
      format(number: number): string;
      formatToParts(number: number): NumberFormatPart[];
      resolvedOptions(): ResolvedNumberFormatOptions;
    }
    
    var NumberFormat: {
      new(locales?: string | string[], options?: NumberFormatOptions): NumberFormat;
      (locales?: string | string[], options?: NumberFormatOptions): string;
      supportedLocalesOf(locales: string | string[], options?: NumberFormatOptions): string[];
    };
  }
}

// Intl.Collator additional types
declare global {
  namespace Intl {
    interface CollatorOptions {
      localeMatcher?: "lookup" | "best fit";
      usage?: "sort" | "search";
      sensitivity?: "base" | "accent" | "case" | "variant";
      ignorePunctuation?: boolean;
      numeric?: boolean;
      caseFirst?: "upper" | "lower" | "false";
      collation?: string;
    }
    
    interface Collator {
      compare(x: string, y: string): number;
      resolvedOptions(): ResolvedCollatorOptions;
    }
    
    var Collator: {
      new(locales?: string | string[], options?: CollatorOptions): Collator;
      (locales?: string | string[], options?: CollatorOptions): number;
      supportedLocalesOf(locales: string | string[], options?: CollatorOptions): string[];
    };
  }
}

// Intl.PluralRules additional types
declare global {
  namespace Intl {
    type PluralRuleType = "cardinal" | "ordinal";
    type LDMLPluralRule = "zero" | "one" | "two" | "few" | "many" | "other";
    
    interface PluralRulesOptions {
      localeMatcher?: "lookup" | "best fit";
      type?: PluralRuleType;
      minimumIntegerDigits?: number;
      minimumFractionDigits?: number;
      maximumFractionDigits?: number;
      minimumSignificantDigits?: number;
      maximumSignificantDigits?: number;
    }
    
    interface PluralRules {
      select(n: number): LDMLPluralRule;
      resolvedOptions(): ResolvedPluralRulesOptions;
    }
    
    var PluralRules: {
      new(locales?: string | string[], options?: PluralRulesOptions): PluralRules;
      supportedLocalesOf(locales: string | string[], options?: PluralRulesOptions): string[];
    };
  }
}

// Intl.RelativeTimeFormat additional types
declare global {
  namespace Intl {
    type RelativeTimeFormatUnit = "year" | "years" | "quarter" | "quarters" | "month" | "months" | "week" | "weeks" | "day" | "days" | "hour" | "hours" | "minute" | "minutes" | "second" | "seconds";
    
    interface RelativeTimeFormatOptions {
      localeMatcher?: "lookup" | "best fit";
      numeric?: "always" | "auto";
      style?: "long" | "short" | "narrow";
    }
    
    interface RelativeTimeFormat {
      format(value: number, unit: RelativeTimeFormatUnit): string;
      formatToParts(value: number, unit: RelativeTimeFormatUnit): RelativeTimeFormatPart[];
      resolvedOptions(): ResolvedRelativeTimeFormatOptions;
    }
    
    var RelativeTimeFormat: {
      new(locales?: string | string[], options?: RelativeTimeFormatOptions): RelativeTimeFormat;
      supportedLocalesOf(locales: string | string[], options?: RelativeTimeFormatOptions): string[];
    };
  }
}

// Intl.ListFormat additional types
declare global {
  namespace Intl {
    type ListFormatType = "conjunction" | "disjunction" | "unit";
    type ListFormatStyle = "long" | "short" | "narrow";
    
    interface ListFormatOptions {
      localeMatcher?: "lookup" | "best fit";
      type?: ListFormatType;
      style?: ListFormatStyle;
    }
    
    interface ListFormat {
      format(elements: string[]): string;
      formatToParts(elements: string[]): ListFormatPart[];
      resolvedOptions(): ResolvedListFormatOptions;
    }
    
    var ListFormat: {
      new(locales?: string | string[], options?: ListFormatOptions): ListFormat;
      supportedLocalesOf(locales: string | string[], options?: ListFormatOptions): string[];
    };
  }
}

// Intl.DisplayNames additional types
declare global {
  namespace Intl {
    type DisplayNamesFallback = "code" | "none";
    
    interface DisplayNamesOptions {
      localeMatcher?: "lookup" | "best fit";
      style?: "narrow" | "short" | "long";
      type?: "language" | "region" | "script" | "currency";
      fallback?: DisplayNamesFallback;
      languageDisplay?: "dialect" | "standard";
    }
    
    interface DisplayNames {
      of(code: string): string | undefined;
      resolvedOptions(): ResolvedDisplayNamesOptions;
    }
    
    var DisplayNames: {
      new(locales: string | string[], options: DisplayNamesOptions): DisplayNames;
      supportedLocalesOf(locales: string | string[], options?: DisplayNamesOptions): string[];
    };
  }
}

// Intl.Locale additional types
declare global {
  namespace Intl {
    type LocaleUnicodeExtensionType = "ca" | "cu" | "ho" | "kf" | "kn" | "nu";
    
    interface LocaleOptions {
      localeMatcher?: "lookup" | "best fit";
    }
    
    interface LocaleInfo {
      locale: string;
      calendar: string | null;
      caseFirst: string | null;
      collation: string | null;
      hourCycle: string | null;
      numberingSystem: string | null;
      numeric: boolean;
    }
    
    interface Locale {
      readonly locale: string;
      readonly calendar: string | null;
      readonly collation: string | null;
      readonly hourCycle: string | null;
      readonly numberingSystem: string | null;
      readonly numeric: boolean;
      maximize(): Locale;
      minimize(): Locale;
      toString(): string;
    }
    
    var Locale: {
      new(tag: string | string[], options?: LocaleOptions): Locale;
      (tag: string | string[], options?: LocaleOptions): Locale;
    };
  }
}

// Intl.Segmenter additional types
declare global {
  namespace Intl {
    type Granularity = "grapheme" | "word" | "sentence";
    
    interface SegmenterOptions {
      localeMatcher?: "lookup" | "best fit";
      granularity?: Granularity;
    }
    
    interface Segment {
      readonly segment: string;
      readonly index: number;
      readonly input: string;
      readonly isWordLike: boolean;
    }
    
    interface Segments {
      readonly [Symbol.iterator](): IterableIterator<Segment>;
      containing(index: number): Segment | undefined;
    }
    
    interface Segmenter {
      segment(input: string): Segments;
      resolvedOptions(): ResolvedSegmenterOptions;
    }
    
    var Segmenter: {
      new(locales?: string | string[], options?: SegmenterOptions): Segmenter;
      supportedLocalesOf(locales: string | string[], options?: SegmenterOptions): string[];
    };
  }
}

// NodeJS.ReadableStream additional types
declare global {
  namespace NodeJS {
    interface ReadableStream {
      read(size?: number): any;
      setEncoding(encoding: BufferEncoding): this;
      pause(): this;
      resume(): this;
      pipe<T extends WritableStream>(destination: T, options?: { end?: boolean }): T;
      unpipe(destination?: WritableStream): this;
      unshift(chunk: any, encoding?: BufferEncoding): void;
      wrap(oldStream: ReadableStream): this;
      [Symbol.asyncIterator](): AsyncIterableIterator<any>;
    }
  }
}

// NodeJS.WritableStream additional types
declare global {
  namespace NodeJS {
    interface WritableStream {
      write(chunk: any, cb?: (err: Error | null) => void): boolean;
      write(chunk: any, encoding: BufferEncoding, cb?: (err: Error | null) => void): boolean;
      end(cb?: () => void): void;
      end(chunk: any, cb?: () => void): void;
      end(chunk: any, encoding: BufferEncoding, cb?: () => void): void;
      cork(): void;
      uncork(): void;
    }
  }
}

// NodeJS.Timeout additional types
declare global {
  namespace NodeJS {
    interface Timeout {
      ref(): this;
      unref(): this;
      hasRef(): boolean;
    }
  }
}

// NodeJS.Immediate additional types
declare global {
  namespace NodeJS {
    interface Immediate {
      ref(): this;
      unref(): this;
      hasRef(): boolean;
      _onImmediate: Function;
    }
  }
}

// NodeJS.Require additional types
declare global {
  namespace NodeJS {
    interface Require {
      (id: string): any;
      resolve: RequireResolve;
      cache: Dict<any>;
      extensions: NodeRequireExtensions;
      main: Module | undefined;
    }
    
    interface RequireResolve {
      (id: string, options?: { paths?: string[] }): string;
      paths(request: string): string[] | null;
    }
    
    interface Module {
      exports: any;
      require: Require;
      id: string;
      filename: string;
      loaded: boolean;
      parent: Module | null;
      children: Module[];
      paths: string[];
    }
    
    type Dict<T> = { [key: string]: T | undefined };
    type ReadonlyDict<T> = { readonly [key: string]: T | undefined };
  }
}

// NodeJS.ErrnoException additional types
declare global {
  namespace NodeJS {
    interface ErrnoException extends Error {
      errno?: number;
      code?: string;
      path?: string;
      syscall?: string;
      stack?: string;
    }
    
    interface TypedArray extends ArrayBufferView {}
    interface ArrayBufferView {
      buffer: ArrayBuffer;
      byteLength: number;
      byteOffset: number;
    }
    
    interface CallSite {
      getThis(): any;
      getTypeName(): string | null;
      getFunction(): Function | undefined;
      getFunctionName(): string | null;
      getMethodName(): string | null;
      getFileName(): string | null;
      getLineNumber(): number | null;
      getColumnNumber(): number | null;
      getEvalOrigin(): string | undefined;
      isToplevel(): boolean;
      isEval(): boolean;
      isNative(): boolean;
      isConstructor(): boolean;
    }
  }
}

// Buffer global additional types
declare global {
  const Buffer: {
    new(size: number): Buffer;
    new(str: string, encoding?: BufferEncoding): Buffer;
    new(buffer: Buffer): Buffer;
    isBuffer(obj: any): obj is Buffer;
    from(array: number[]): Buffer;
    from(arrayBuffer: ArrayBuffer, byteOffset?: number, length?: number): Buffer;
    from(buffer: Buffer): Buffer;
    from(data: any, encoding?: BufferEncoding): Buffer;
    from(string: string, encoding?: BufferEncoding): Buffer;
    alloc(size: number, fill?: string | Buffer | number, encoding?: BufferEncoding): Buffer;
    allocUnsafe(size: number): Buffer;
    allocUnsafeSlow(size: number): Buffer;
    byteLength(string: string, encoding?: BufferEncoding): number;
    compare(buf1: Buffer, buf2: Buffer): number;
    concat(list: Buffer[], totalLength?: number): Buffer;
    isEncoding(encoding: string): encoding is BufferEncoding;
    poolSize: number;
  };
}

// process global additional types
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      [key: string]: string | undefined;
    }
    
    interface ProcessRelease {
      name: string;
      sourceUrl?: string;
      headersUrl?: string;
      libUrl?: string;
      lts?: string;
    }
    
    interface ProcessVersions {
      node: string;
      bun: string;
      v8: string;
      uv: string;
      zlib: string;
      brotli: string;
      ares: string;
      modules: string;
      openssl: string;
    }
    
    interface HRTime<T extends number[]> {
      (time?: T): T;
    }
    
    interface CpuUsage {
      user: number;
      system: number;
    }
    
    interface MemoryUsage {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      external: number;
      arrayBuffers: number;
    }
  }
}

// global global additional types
declare global {
  var global: typeof globalThis;
  
  interface Global {
    Array: typeof Array;
    ArrayBuffer: typeof ArrayBuffer;
    BigInt: typeof BigInt;
    BigInt64Array: typeof BigInt64Array;
    Boolean: typeof Boolean;
    DataView: typeof DataView;
    Date: typeof Date;
    Error: typeof Error;
    EvalError: typeof EvalError;
    Float32Array: typeof Float32Array;
    Float64Array: typeof Float64Array;
    Function: typeof Function;
    Int8Array: typeof Int8Array;
    Int16Array: typeof Int16Array;
    Int32Array: typeof Int32Array;
    Map: typeof Map;
    NaN: number;
    Infinity: number;
    undefined: any;
    Number: typeof Number;
    Object: typeof Object;
    Promise: typeof Promise;
    RangeError: typeof RangeError;
    ReferenceError: typeof ReferenceError;
    RegExp: typeof RegExp;
    Set: typeof Set;
    String: typeof String;
    Symbol: typeof Symbol;
    SyntaxError: typeof SyntaxError;
    TypeError: typeof TypeError;
    Uint8Array: typeof Uint8Array;
    Uint8ClampedArray: typeof Uint8ClampedArray;
    Uint16Array: typeof Uint16Array;
    Uint32Array: typeof Uint32Array;
    URIError: typeof URIError;
    WeakMap: typeof WeakMap;
    WeakSet: typeof WeakSet;
    decodeURI: (encodedURI: string) => string;
    decodeURIComponent: (encodedURIComponent: string) => string;
    encodeURI: (uri: string) => string;
    encodeURIComponent: (uriComponent: string) => string;
    eval: (x: string) => any;
    isFinite: (number: number) => boolean;
    isNaN: (number: number) => boolean;
    parseFloat: (string: string) => number;
    parseInt: (string: string, radix?: number) => number;
  }
}

// queueMicrotask additional types
declare global {
  function queueMicrotask(callback: () => void): void;
}

// clearImmediate and setImmediate additional types
declare global {
  function clearImmediate(immediateId: NodeJS.Immediate): void;
  function setImmediate(callback: (...args: any[]) => void, ...args: any[]): NodeJS.Immediate;
}

// clearInterval and clearTimeout additional types
declare global {
  function clearInterval(intervalId: NodeJS.Timeout): void;
  function clearTimeout(timeoutId: NodeJS.Timeout): void;
}

// setInterval additional types
declare global {
  function setInterval(callback: (...args: any[]) => void, ms: number, ...args: any[]): NodeJS.Timeout;
}

// setTimeout additional types
declare global {
  function setTimeout(callback: (...args: any[]) => void, ms: number, ...args: any[]): NodeJS.Timeout;
}

// structuredClone additional types
declare global {
  function structuredClone<T>(value: T, options?: StructuredSerializeOptions): T;
  
  interface StructuredSerializeOptions {
    transfer?: any[];
  }
}

// escape and unescape additional types
declare global {
  function escape(str: string): string;
  function unescape(str: string): string;
}
