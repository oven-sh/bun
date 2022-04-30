// Type definitions for bun 0.0
// Project: https://github.com/Jarred-Sumner/bun
// Definitions by: Jarred Sumner <https://github.com/Jarred-Sumner>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped
/// <reference no-default-lib="true" />
/// <reference lib="esnext" />

// This file is bundled so that your TypeScript editor integration loads it faster.
// ./bun.d.ts

interface VoidFunction {
  (): void;
}

/**
 *
 * Bun.js runtime APIs
 *
 * @example
 *
 * ```js
 * import {file} from 'bun';
 *
 * // Log the file to the console
 * const input = await file('/path/to/file.txt').text();
 * console.log(input);
 * ```
 *
 * This module aliases `globalThis.Bun`.
 *
 */
declare module "bun" {
  /**
   * Start a fast HTTP server.
   *
   * @param options Server options (port defaults to $PORT || 8080)
   *
   * -----
   *
   * @example
   *
   * ```ts
   * Bun.serve({
   *   fetch(req: Request): Response | Promise<Response> {
   *     return new Response("Hello World!");
   *   },
   *
   *   // Optional port number - the default value is 3000
   *   port: process.env.PORT || 3000,
   * });
   * ```
   * -----
   *
   * @example
   *
   * Send a file
   *
   * ```ts
   * Bun.serve({
   *   fetch(req: Request): Response | Promise<Response> {
   *     return new Response(Bun.file("./package.json"));
   *   },
   *
   *   // Optional port number - the default value is 3000
   *   port: process.env.PORT || 3000,
   * });
   * ```
   */
  export function serve(options: Serve): Server;

  /**
   * Synchronously resolve a `moduleId` as though it were imported from `parent`
   *
   * On failure, throws a `ResolveError`
   */
  // tslint:disable-next-line:unified-signatures
  export function resolveSync(moduleId: string, parent: string): string;

  /**
   * Resolve a `moduleId` as though it were imported from `parent`
   *
   * On failure, throws a `ResolveError`
   *
   * For now, use the sync version. There is zero performance benefit to using this async version. It exists for future-proofing.
   */
  // tslint:disable-next-line:unified-signatures
  export function resolve(moduleId: string, parent: string): Promise<string>;

  /**
   *
   * Use the fastest syscalls available to copy from `input` into `destination`.
   *
   * If `destination` exists, it must be a regular file or symlink to a file.
   *
   * @param destination The file or file path to write to
   * @param input The data to copy into `destination`.
   * @returns A promise that resolves with the number of bytes written.
   */
  // tslint:disable-next-line:unified-signatures
  export function write(
    destination: FileBlob | PathLike,
    input: Blob | TypedArray | string | BlobPart[]
  ): Promise<number>;

  /**
   *
   * Persist a {@link Response} body to disk.
   *
   * @param destination The file to write to. If the file doesn't exist,
   * it will be created and if the file does exist, it will be
   * overwritten. If `input`'s size is less than `destination`'s size,
   * `destination` will be truncated.
   * @param input - `Response` object
   * @returns A promise that resolves with the number of bytes written.
   */
  export function write(
    destination: FileBlob,
    input: Response
  ): Promise<number>;

  /**
   *
   * Persist a {@link Response} body to disk.
   *
   * @param destinationPath The file path to write to. If the file doesn't
   * exist, it will be created and if the file does exist, it will be
   * overwritten. If `input`'s size is less than `destination`'s size,
   * `destination` will be truncated.
   * @param input - `Response` object
   * @returns A promise that resolves with the number of bytes written.
   */
  // tslint:disable-next-line:unified-signatures
  export function write(
    destinationPath: PathLike,
    input: Response
  ): Promise<number>;

  /**
   *
   * Use the fastest syscalls available to copy from `input` into `destination`.
   *
   * If `destination` exists, it must be a regular file or symlink to a file.
   *
   * On Linux, this uses `copy_file_range`.
   *
   * On macOS, when the destination doesn't already exist, this uses
   * [`clonefile()`](https://www.manpagez.com/man/2/clonefile/) and falls
   * back to [`fcopyfile()`](https://www.manpagez.com/man/2/fcopyfile/)
   *
   * @param destination The file to write to. If the file doesn't exist,
   * it will be created and if the file does exist, it will be
   * overwritten. If `input`'s size is less than `destination`'s size,
   * `destination` will be truncated.
   * @param input The file to copy from.
   * @returns A promise that resolves with the number of bytes written.
   */
  // tslint:disable-next-line:unified-signatures
  export function write(
    destination: FileBlob,
    input: FileBlob
  ): Promise<number>;

  /**
   *
   * Use the fastest syscalls available to copy from `input` into `destination`.
   *
   * If `destination` exists, it must be a regular file or symlink to a file.
   *
   * On Linux, this uses `copy_file_range`.
   *
   * On macOS, when the destination doesn't already exist, this uses
   * [`clonefile()`](https://www.manpagez.com/man/2/clonefile/) and falls
   * back to [`fcopyfile()`](https://www.manpagez.com/man/2/fcopyfile/)
   *
   * @param destinationPath The file path to write to. If the file doesn't
   * exist, it will be created and if the file does exist, it will be
   * overwritten. If `input`'s size is less than `destination`'s size,
   * `destination` will be truncated.
   * @param input The file to copy from.
   * @returns A promise that resolves with the number of bytes written.
   */
  // tslint:disable-next-line:unified-signatures
  export function write(
    destinationPath: PathLike,
    input: FileBlob
  ): Promise<number>;

  export interface SystemError extends Error {
    errno?: number | undefined;
    code?: string | undefined;
    path?: string | undefined;
    syscall?: string | undefined;
  }

  /**
   * [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) powered by the fastest system calls available for operating on files.
   *
   * This Blob is lazy. That means it won't do any work until you read from it.
   *
   * - `size` will not be valid until the contents of the file are read at least once.
   * - `type` is auto-set based on the file extension when possible
   *
   * @example
   * ```js
   * const file = Bun.file("./hello.json");
   * console.log(file.type); // "application/json"
   * console.log(await file.text()); // '{"hello":"world"}'
   * ```
   *
   * @example
   * ```js
   * await Bun.write(
   *   Bun.file("./hello.txt"),
   *   "Hello, world!"
   * );
   * ```
   *
   */
  export interface FileBlob extends Blob {
    /**
     * Offset any operation on the file starting at `begin` and ending at `end`. `end` is relative to 0
     *
     * Similar to [`TypedArray.subarray`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray/subarray). Does not copy the file, open the file, or modify the file.
     *
     * If `begin` > 0, {@link Bun.write()} will be slower on macOS
     *
     * @param begin - start offset in bytes
     * @param end - absolute offset in bytes (relative to 0)
     */
    slice(begin?: number, end?: number): FileBlob;
  }

  /**
   *   This lets you use macros as regular imports
   *   @example
   *   ```
   *   {
   *     "react-relay": {
   *       "graphql": "bun-macro-relay/bun-macro-relay.tsx"
   *     }
   *   }
   *  ```
   */
  export type MacroMap = Record<string, Record<string, string>>;

  /**
   * Hash a string or array buffer using Wyhash
   *
   * This is not a cryptographic hash function.
   * @param data The data to hash.
   * @param seed The seed to use.
   */
  export const hash: ((
    data: string | ArrayBufferView | ArrayBuffer,
    seed?: number
  ) => number | bigint) &
    Hash;

  interface Hash {
    wyhash: (
      data: string | ArrayBufferView | ArrayBuffer,
      seed?: number
    ) => number | bigint;
    crc32: (
      data: string | ArrayBufferView | ArrayBuffer,
      seed?: number
    ) => number | bigint;
    adler32: (
      data: string | ArrayBufferView | ArrayBuffer,
      seed?: number
    ) => number | bigint;
    cityHash32: (
      data: string | ArrayBufferView | ArrayBuffer,
      seed?: number
    ) => number | bigint;
    cityHash64: (
      data: string | ArrayBufferView | ArrayBuffer,
      seed?: number
    ) => number | bigint;
    murmur32v3: (
      data: string | ArrayBufferView | ArrayBuffer,
      seed?: number
    ) => number | bigint;
    murmur64v2: (
      data: string | ArrayBufferView | ArrayBuffer,
      seed?: number
    ) => number | bigint;
  }

  export type Platform =
    /**
     * When building for bun.js
     */
    | "bun"
    /**
     * When building for the web
     */
    | "browser"
    /**
     * When building for node.js
     */
    | "node"
    | "neutral";

  export type JavaScriptLoader = "jsx" | "js" | "ts" | "tsx";

  export interface TranspilerOptions {
    /**
     * Replace key with value. Value must be a JSON string.
     * @example
     *  ```
     *  { "process.env.NODE_ENV": "\"production\"" }
     * ```
     */
    define?: Record<string, string>;

    /** What is the default loader used for this transpiler?  */
    loader?: JavaScriptLoader;

    /**  What platform are we targeting? This may affect how import and/or require is used */
    /**  @example "browser" */
    platform?: Platform;

    /**
     *  TSConfig.json file as stringified JSON or an object
     *  Use this to set a custom JSX factory, fragment, or import source
     *  For example, if you want to use Preact instead of React. Or if you want to use Emotion.
     */
    tsconfig?: string;

    /**
     *    Replace an import statement with a macro.
     *
     *    This will remove the import statement from the final output
     *    and replace any function calls or template strings with the result returned by the macro
     *
     *    @example
     *    ```json
     *    {
     *        "react-relay": {
     *            "graphql": "bun-macro-relay"
     *        }
     *    }
     *    ```
     *
     *    Code that calls `graphql` will be replaced with the result of the macro.
     *
     *    ```js
     *    import {graphql} from "react-relay";
     *
     *    // Input:
     *    const query = graphql`
     *        query {
     *            ... on User {
     *                id
     *            }
     *        }
     *    }`;
     *    ```
     *
     *    Will be replaced with:
     *
     *    ```js
     *    import UserQuery from "./UserQuery.graphql";
     *    const query = UserQuery;
     *    ```
     */
    macros: MacroMap;
  }

  /**
   * Quickly transpile TypeScript, JSX, or JS to modern JavaScript.
   *
   * @example
   * ```js
   * const transpiler = new Bun.Transpiler();
   * transpiler.transformSync(`
   *   const App = () => <div>Hello World</div>;
   *export default App;
   * `);
   * // This outputs:
   * const output = `
   * const App = () => jsx("div", {
   *   children: "Hello World"
   * }, undefined, false, undefined, this);
   *export default App;
   * `
   * ```
   *
   */
  export class Transpiler {
    constructor(options: TranspilerOptions);

    /**
     * Transpile code from TypeScript or JSX into valid JavaScript.
     * This function does not resolve imports.
     * @param code The code to transpile
     */
    transform(code: StringOrBuffer, loader?: JavaScriptLoader): Promise<string>;
    /**
     * Transpile code from TypeScript or JSX into valid JavaScript.
     * This function does not resolve imports.
     * @param code The code to transpile
     *
     */
    transformSync(code: StringOrBuffer, loader?: JavaScriptLoader): string;

    /**
     * Get a list of import paths and paths from a TypeScript, JSX, TSX, or JavaScript file.
     * @param code The code to scan
     * @example
     * ```js
     * const {imports, exports} = transpiler.scan(`
     * import {foo} from "baz";
     * const hello = "hi!";
     * `);
     *
     * console.log(imports); // ["baz"]
     * console.log(exports); // ["hello"]
     * ```
     */
    scan(code: StringOrBuffer): { exports: string[]; imports: Import[] };

    /**
     *  Get a list of import paths from a TypeScript, JSX, TSX, or JavaScript file.
     * @param code The code to scan
     * @example
     * ```js
     * const imports = transpiler.scanImports(`
     * import {foo} from "baz";
     * import type {FooType} from "bar";
     * import type {DogeType} from "wolf";
     * `);
     *
     * console.log(imports); // ["baz"]
     * ```
     * This is a fast path which performs less work than `scan`.
     */
    scanImports(code: StringOrBuffer): Import[];
  }

  export interface Import {
    path: string;

    kind:
      | "import-statement"
      | "require-call"
      | "require-resolve"
      | "dynamic-import"
      | "import-rule"
      | "url-token"
      | "internal"
      | "entry-point";
  }

  export interface ServeOptions {
    /**
     * What port should the server listen on?
     * @default process.env.PORT || "3000"
     */
    port?: string | number;

    /**
     * What hostname should the server listen on?
     *
     * @default
     * ```js
     * "0.0.0.0" // listen on all interfaces
     * ```
     * @example
     *  ```js
     * "127.0.0.1" // Only listen locally
     * ```
     * @example
     * ```js
     * "remix.run" // Only listen on remix.run
     * ````
     *
     * note: hostname should not include a {@link port}
     */
    hostname?: string;

    /**
     * What URI should be used to make {@link Request.url} absolute?
     *
     * By default, looks at {@link hostname}, {@link port}, and whether or not SSL is enabled to generate one
     *
     * @example
     *```js
     * "http://my-app.com"
     * ```
     *
     * @example
     *```js
     * "https://wongmjane.com/"
     * ```
     *
     * This should be the public, absolute URL – include the protocol and {@link hostname}. If the port isn't 80 or 443, then include the {@link port} too.
     *
     * @example
     * "http://localhost:3000"
     *
     */
    baseURI?: string;

    /**
     * What is the maximum size of a request body? (in bytes)
     * @default 1024 * 1024 * 128 // 128MB
     */
    maxRequestBodySize?: number;

    /**
     * Render contextual errors? This enables bun's error page
     * @default process.env.NODE_ENV !== 'production'
     */
    development?: boolean;

    /**
     * Handle HTTP requests
     *
     * Respond to {@link Request} objects with a {@link Response} object.
     *
     */
    fetch(this: Server, request: Request): Response | Promise<Response>;

    error?: (
      this: Server,
      request: Errorlike
    ) => Response | Promise<Response> | undefined | Promise<undefined>;
  }

  export interface Errorlike extends Error {
    code?: string;
    errno?: number;
    syscall?: string;
  }

  export interface SSLAdvancedOptions {
    passphrase?: string;
    caFile?: string;
    dhParamsFile?: string;

    /**
     * This sets `OPENSSL_RELEASE_BUFFERS` to 1.
     * It reduces overall performance but saves some memory.
     * @default false
     */
    lowMemoryMode?: boolean;
  }
  interface SSLOptions {
    /**
     * File path to a TLS key
     *
     * To enable TLS, this option is required.
     */
    keyFile: string;
    /**
     * File path to a TLS certificate
     *
     * To enable TLS, this option is required.
     */
    certFile: string;
  }

  export type SSLServeOptions = ServeOptions &
    SSLOptions &
    SSLAdvancedOptions & {
      /**
       *  The keys are [SNI](https://en.wikipedia.org/wiki/Server_Name_Indication) hostnames.
       *  The values are SSL options objects.
       */
      serverNames: Record<string, SSLOptions & SSLAdvancedOptions>;
    };

  /**
   * HTTP & HTTPS Server
   *
   * To start the server, see {@link serve}
   *
   * Often, you don't need to interact with this object directly. It exists to help you with the following tasks:
   * - Stop the server
   * - How many requests are currently being handled?
   *
   * For performance, Bun pre-allocates most of the data for 2048 concurrent requests.
   * That means starting a new server allocates about 500 KB of memory. Try to
   * avoid starting and stopping the server often (unless it's a new instance of bun).
   *
   * Powered by a fork of [uWebSockets](https://github.com/uNetworking/uWebSockets). Thank you @alexhultman.
   *
   */
  interface Server {
    /**
     * Stop listening to prevent new connections from being accepted.
     *
     * It does not close existing connections.
     *
     * It may take a second or two to actually stop.
     */
    stop(): void;

    /**
     * How many requests are in-flight right now?
     */
    readonly pendingRequests: number;
    readonly port: number;
    readonly hostname: string;
    readonly development: boolean;
  }

  export type Serve = SSLServeOptions | ServeOptions;

  /**
   * [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) powered by the fastest system calls available for operating on files.
   *
   * This Blob is lazy. That means it won't do any work until you read from it.
   *
   * - `size` will not be valid until the contents of the file are read at least once.
   * - `type` is auto-set based on the file extension when possible
   *
   * @example
   * ```js
   * const file = Bun.file("./hello.json");
   * console.log(file.type); // "application/json"
   * console.log(await file.json()); // { hello: "world" }
   * ```
   *
   * @example
   * ```js
   * await Bun.write(
   *   Bun.file("./hello.txt"),
   *   "Hello, world!"
   * );
   * ```
   * @param path The path to the file (lazily loaded)
   *
   */
  // tslint:disable-next-line:unified-signatures
  export function file(path: string, options?: BlobPropertyBag): FileBlob;

  /**
   * `Blob` that leverages the fastest system calls available to operate on files.
   *
   * This Blob is lazy. It won't do any work until you read from it. Errors propagate as promise rejections.
   *
   * `Blob.size` will not be valid until the contents of the file are read at least once.
   * `Blob.type` will have a default set based on the file extension
   *
   * @example
   * ```js
   * const file = Bun.file(new TextEncoder.encode("./hello.json"));
   * console.log(file.type); // "application/json"
   * ```
   *
   * @param path The path to the file as a byte buffer (the buffer is copied)
   */
  // tslint:disable-next-line:unified-signatures
  export function file(
    path: ArrayBufferLike | Uint8Array,
    options?: BlobPropertyBag
  ): FileBlob;

  /**
   * [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) powered by the fastest system calls available for operating on files.
   *
   * This Blob is lazy. That means it won't do any work until you read from it.
   *
   * - `size` will not be valid until the contents of the file are read at least once.
   *
   * @example
   * ```js
   * const file = Bun.file(fd);
   * ```
   *
   * @param fileDescriptor The file descriptor of the file
   */
  // tslint:disable-next-line:unified-signatures
  export function file(
    fileDescriptor: number,
    options?: BlobPropertyBag
  ): FileBlob;

  /**
   * Allocate a new [`Uint8Array`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Uint8Array) without zeroing the bytes.
   *
   * This can be 3.5x faster than `new Uint8Array(size)`, but if you send uninitialized memory to your users (even unintentionally), it can potentially leak anything recently in memory.
   */
  export function allocUnsafe(size: number): Uint8Array;

  /**
   * Pretty-print an object the same as {@link console.log} to a `string`
   *
   * Supports JSX
   *
   * @param args
   */
  export function inspect(...args: any): string;

  interface MMapOptions {
    /**
     * Sets MAP_SYNC flag on Linux. Ignored on macOS due to lack of support.
     */
    sync?: boolean;
    /**
     * Allow other processes to see results instantly?
     * This enables MAP_SHARED. If false, it enables MAP_PRIVATE.
     * @default true
     */
    shared?: boolean;
  }
  /**
   * Open a file as a live-updating `Uint8Array` without copying memory
   * - Writing to the array writes to the file.
   * - Reading from the array reads from the file.
   *
   * This uses the [`mmap()`](https://man7.org/linux/man-pages/man2/mmap.2.html) syscall under the hood.
   *
   * ---
   *
   * This API inherently has some rough edges:
   * - It does not support empty files. It will throw a `SystemError` with `EINVAL`
   * - Usage on shared/networked filesystems is discouraged. It will be very slow.
   * - If you delete or truncate the file, that will crash bun. This is called a segmentation fault.
   *
   * ---
   *
   * To close the file, set the array to `null` and it will be garbage collected eventually.
   *
   */
  export function mmap(path: PathLike, opts?: MMapOptions): Uint8Array;

  /** Write to stdout */
  const stdout: FileBlob;
  /** Write to stderr */
  const stderr: FileBlob;
  /**
   * Read from stdin
   *
   * This is read-only
   */
  const stdin: FileBlob;

  interface unsafe {
    /**
     * Cast bytes to a `String` without copying. This is the fastest way to get a `String` from a `Uint8Array` or `ArrayBuffer`.
     *
     * **Only use this for ASCII strings**. If there are non-ascii characters, your application may crash and/or very confusing bugs will happen such as `"foo" !== "foo"`.
     *
     * **The input buffer must not be garbage collected**. That means you will need to hold on to it for the duration of the string's lifetime.
     *
     */
    arrayBufferToString(buffer: Uint8Array | ArrayBufferLike): string;

    /**
     * Cast bytes to a `String` without copying. This is the fastest way to get a `String` from a `Uint16Array`
     *
     * **The input must be a UTF-16 encoded string**. This API does no validation whatsoever.
     *
     * **The input buffer must not be garbage collected**. That means you will need to hold on to it for the duration of the string's lifetime.
     *
     */
    // tslint:disable-next-line:unified-signatures
    arrayBufferToString(buffer: Uint16Array): string;

    /** Mock bun's segfault handler. You probably don't want to use this */
    segfault(): void;
  }
  export const unsafe: unsafe;

  type DigestEncoding = "hex" | "base64";

  /**
   * Are ANSI colors enabled for stdin and stdout?
   *
   * Used for {@link console.log}
   */
  export const enableANSIColors: boolean;

  /**
   * What script launched bun?
   *
   * Absolute file path
   *
   * @example "/never-gonna-give-you-up.js"
   */
  export const main: string;

  /**
   * Manually trigger the garbage collector
   *
   * This does two things:
   * 1. It tells JavaScriptCore to run the garbage collector
   * 2. It tells [mimalloc](https://github.com/microsoft/mimalloc) to clean up fragmented memory. Mimalloc manages the heap not used in JavaScriptCore.
   *
   * @param force Synchronously run the garbage collector
   */
  export function gc(force: boolean): void;

  /**
   * JavaScriptCore engine's internal heap snapshot
   *
   * I don't know how to make this something Chrome or Safari can read.
   *
   * If you have any ideas, please file an issue https://github.com/Jarred-Sumner/bun
   */
  interface HeapSnapshot {
    /** "2" */
    version: string;

    /** "Inspector" */
    type: string;

    nodes: number[];

    nodeClassNames: string[];
    edges: number[];
    edgeTypes: string[];
    edgeNames: string[];
  }

  /**
   * Generate a heap snapshot for seeing where the heap is being used
   */
  export function generateHeapSnapshot(): HeapSnapshot;

  /**
   * The next time JavaScriptCore is idle, clear unused memory and attempt to reduce the heap size.
   */
  export function shrink(): void;

  /**
   * Open a file in your local editor. Auto-detects via `$VISUAL` || `$EDITOR`
   *
   * @param path path to open
   */
  export function openInEditor(path: string, options?: EditorOptions): void;

  interface EditorOptions {
    editor?: "vscode" | "subl";
    line?: number;
    column?: number;
  }

  /**
   * This class only exists in types
   */
  abstract class CryptoHashInterface<T> {
    /**
     * Update the hash with data
     *
     * @param data
     */
    update(data: StringOrBuffer): T;

    /**
     * Finalize the hash
     *
     * @param encoding `DigestEncoding` to return the hash in. If none is provided, it will return a `Uint8Array`.
     */
    digest(encoding: DigestEncoding): string;

    /**
     * Finalize the hash
     *
     * @param hashInto `TypedArray` to write the hash into. Faster than creating a new one each time
     */
    digest(hashInto?: TypedArray): TypedArray;

    /**
     * Run the hash over the given data
     *
     * @param input `string`, `Uint8Array`, or `ArrayBuffer` to hash. `Uint8Array` or `ArrayBuffer` is faster.
     *
     * @param hashInto `TypedArray` to write the hash into. Faster than creating a new one each time
     */
    static hash(input: StringOrBuffer, hashInto?: TypedArray): TypedArray;

    /**
     * Run the hash over the given data
     *
     * @param input `string`, `Uint8Array`, or `ArrayBuffer` to hash. `Uint8Array` or `ArrayBuffer` is faster.
     *
     * @param encoding `DigestEncoding` to return the hash in
     */
    static hash(input: StringOrBuffer, encoding: DigestEncoding): string;
  }

  /**
   *
   * Hash `input` using [SHA-2 512/256](https://en.wikipedia.org/wiki/SHA-2#Comparison_of_SHA_functions)
   *
   * @param input `string`, `Uint8Array`, or `ArrayBuffer` to hash. `Uint8Array` or `ArrayBuffer` will be faster
   * @param hashInto optional `Uint8Array` to write the hash to. 32 bytes minimum.
   *
   * This hashing function balances speed with cryptographic strength. This does not encrypt or decrypt data.
   *
   * The implementation uses [BoringSSL](https://boringssl.googlesource.com/boringssl) (used in Chromium & Go)
   *
   * The equivalent `openssl` command is:
   *
   * ```bash
   * # You will need OpenSSL 3 or later
   * openssl sha512-256 /path/to/file
   *```
   */
  export function sha(input: StringOrBuffer, hashInto?: Uint8Array): Uint8Array;

  /**
   *
   * Hash `input` using [SHA-2 512/256](https://en.wikipedia.org/wiki/SHA-2#Comparison_of_SHA_functions)
   *
   * @param input `string`, `Uint8Array`, or `ArrayBuffer` to hash. `Uint8Array` or `ArrayBuffer` will be faster
   * @param encoding `DigestEncoding` to return the hash in
   *
   * This hashing function balances speed with cryptographic strength. This does not encrypt or decrypt data.
   *
   * The implementation uses [BoringSSL](https://boringssl.googlesource.com/boringssl) (used in Chromium & Go)
   *
   * The equivalent `openssl` command is:
   *
   * ```bash
   * # You will need OpenSSL 3 or later
   * openssl sha512-256 /path/to/file
   *```
   */
  export function sha(input: StringOrBuffer, encoding: DigestEncoding): string;

  /**
   * This is not the default because it's not cryptographically secure and it's slower than {@link SHA512}
   *
   * Consider using the ugly-named {@link SHA512_256} instead
   */
  export class SHA1 extends CryptoHashInterface<SHA1> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 20;
  }
  export class MD5 extends CryptoHashInterface<MD5> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 16;
  }
  export class MD4 extends CryptoHashInterface<MD4> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 16;
  }
  export class SHA224 extends CryptoHashInterface<SHA224> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 28;
  }
  export class SHA512 extends CryptoHashInterface<SHA512> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 64;
  }
  export class SHA384 extends CryptoHashInterface<SHA384> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 48;
  }
  export class SHA256 extends CryptoHashInterface<SHA256> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 32;
  }
  /**
   * See also {@link sha}
   */
  export class SHA512_256 extends CryptoHashInterface<SHA512_256> {
    constructor();

    /**
     * The number of bytes the hash will produce
     */
    static readonly byteLength: 32;
  }
}

type TypedArray =
  | Uint8Array
  | Int8Array
  | Uint8ClampedArray
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Float32Array
  | Float64Array;
type TimeLike = string | number | Date;
type StringOrBuffer = string | TypedArray | ArrayBufferLike;
type PathLike = string | TypedArray | ArrayBufferLike;
type PathOrFileDescriptor = PathLike | number;
type NoParamCallback = VoidFunction;
type BufferEncoding =
  | "buffer"
  | "utf8"
  | "utf-8"
  | "ascii"
  | "utf16le"
  | "ucs2"
  | "ucs-2"
  | "latin1"
  | "binary";

interface BufferEncodingOption {
  encoding?: BufferEncoding;
}

declare var Bun: typeof import("bun");


// ./ffi.d.ts

/**
 * `bun:ffi` lets you efficiently call C functions & FFI functions from JavaScript
 *  without writing any C code yourself.
 *
 * ```js
 * import {dlopen, CString, ptr} from 'bun:ffi';
 *
 * const lib = dlopen('libsqlite3', {});
 *
 *
 * ```
 *
 * This is powered by just-in-time compiling C wrappers
 * that convert JavaScript types to C types and back. Internally,
 * bun uses [tinycc](https://github.com/TinyCC/tinycc), so a big thanks
 * goes to Fabrice Bellard and TinyCC maintainers for making this possible.
 *
 */
declare module "bun:ffi" {
  export enum FFIType {
    char = 0,

    int8_t = 1,
    i8 = 1,

    uint8_t = 2,
    u8 = 2,

    int16_t = 3,
    i16 = 3,

    uint16_t = 4,
    u16 = 4,

    /**
     * 32-bit signed integer
     *
     */
    int32_t = 5,

    /**
     * 32-bit signed integer
     *
     * Alias of {@link FFIType.int32_t}
     */
    i32 = 5,
    /**
     * 32-bit signed integer
     *
     * The same as `int` in C
     */
    int = 5,

    uint32_t = 6,
    u32 = 6,

    int64_t = 7,
    i64 = 7,

    uint64_t = 8,
    u64 = 8,

    double = 9,
    f64 = 9,

    float = 10,
    f32 = 10,

    bool = 11,

    ptr = 12,
    pointer = 12,

    void = 13,
  }

  type Symbols = Record<
    string,
    {
      /**
       * Arguments to a C function
       *
       * Defaults to an empty array, which means no arguments.
       *
       * To pass a pointer, use "ptr" or "pointer" as the type name. To get a pointer, see {@link ptr}.
       *
       * @example
       * From JavaScript:
       * ```js
       * const lib = dlopen('add', {
       *    // FFIType can be used or you can pass string labels.
       *    args: [FFIType.i32, "i32"],
       *    return_type: "i32",
       * });
       * lib.symbols.add(1, 2)
       * ```
       * In C:
       * ```c
       * int add(int a, int b) {
       *   return a + b;
       * }
       * ```
       */
      args?: FFIType[];
      return_type?: FFIType;
    }
  >;

  export interface Library {
    symbols: Record<string, CallableFunction>;

    /**
     * `dlclose` the library, unloading the symbols and freeing memory allocated.
     *
     * Once called, the library is no longer usable.
     *
     * Calling a function from a library that has been closed is undefined behavior.
     */
    close(): void;
  }

  export function dlopen(libraryName: string, symbols: Symbols): Library<T>;

  /**
   * Read a pointer as a {@link Buffer}
   *
   * If `byteLength` is not provided, the pointer is assumed to be 0-terminated.
   *
   * @param ptr The memory address to read
   * @param byteOffset bytes to skip before reading
   * @param byteLength bytes to read
   *
   * While there are some checks to catch invalid pointers, this is a difficult
   * thing to do safely. Passing an invalid pointer can crash the program and
   * reading beyond the bounds of the pointer will crash the program or cause
   * undefined behavior. Use with care!
   *
   */
  export function toBuffer(
    ptr: number,
    byteOffset?: number,
    byteLength?: number
  ): Buffer;

  /**
   * Read a pointer as an {@link ArrayBuffer}
   *
   * If `byteLength` is not provided, the pointer is assumed to be 0-terminated.
   *
   * @param ptr The memory address to read
   * @param byteOffset bytes to skip before reading
   * @param byteLength bytes to read
   *
   * While there are some checks to catch invalid pointers, this is a difficult
   * thing to do safely. Passing an invalid pointer can crash the program and
   * reading beyond the bounds of the pointer will crash the program or cause
   * undefined behavior. Use with care!
   */
  export function toArrayBuffer(
    ptr: number,
    byteOffset?: number,
    byteLength?: number
  ): ArrayBuffer;

  /**
   * Get the pointer backing a {@link TypedArray} or {@link ArrayBuffer}
   *
   * Use this to pass {@link TypedArray} or {@link ArrayBuffer} to C functions.
   *
   * This is for use with FFI functions. For performance reasons, FFI will
   * not automatically convert typed arrays to C pointers.
   *
   * @param {TypedArray|ArrayBuffer|DataView} view the typed array or array buffer to get the pointer for
   * @param {number} byteOffset optional offset into the view in bytes
   *
   * @example
   *
   * From JavaScript:
   * ```js
   * const array = new Uint8Array(10);
   * const rawPtr = ptr(array);
   * myCFunction(rawPtr);
   * ```
   * To C:
   * ```c
   * void myCFunction(char* rawPtr) {
   *  // Do something with rawPtr
   * }
   * ```
   *
   */
  export function ptr(
    view: TypedArray | ArrayBufferLike | DataView,
    byteOffset?: number
  ): number;

  /**
   * Get a string from a UTF-8 encoded C string
   * If `byteLength` is not provided, the string is assumed to be null-terminated.
   *
   * @example
   * ```js
   * var ptr = lib.symbols.getVersion();
   * console.log(new CString(ptr));
   * ```
   *
   * @example
   * ```js
   * var ptr = lib.symbols.getVersion();
   * // print the first 4 characters
   * console.log(new CString(ptr, 0, 4));
   * ```
   *
   * While there are some checks to catch invalid pointers, this is a difficult
   * thing to do safely. Passing an invalid pointer can crash the program and
   * reading beyond the bounds of the pointer will crash the program or cause
   * undefined behavior. Use with care!
   */
  export interface CString {
    /**
     * Get a string from a UTF-8 encoded C string
     * If `byteLength` is not provided, the string is assumed to be null-terminated.
     *
     * @param ptr The pointer to the C string
     * @param byteOffset bytes to skip before reading
     * @param byteLength bytes to read
     *
     *
     * @example
     * ```js
     * var ptr = lib.symbols.getVersion();
     * console.log(new CString(ptr));
     * ```
     *
     * @example
     * ```js
     * var ptr = lib.symbols.getVersion();
     * // print the first 4 characters
     * console.log(new CString(ptr, 0, 4));
     * ```
     *
     * While there are some checks to catch invalid pointers, this is a difficult
     * thing to do safely. Passing an invalid pointer can crash the program and
     * reading beyond the bounds of the pointer will crash the program or cause
     * undefined behavior. Use with care!
     */
    new (ptr: number, byteOffset?: number, byteLength?: number): string;
  }

  /**
   * View the generated C code for FFI bindings
   *
   * You probably won't need this unless there's a bug in the FFI bindings
   * generator or you're just curious.
   */
  export function viewSource(symbols: Symbols): string[];
}


// ./fs.d.ts

/**
 * The `fs` module enables interacting with the file system in a
 * way modeled on standard POSIX functions.
 *
 * ```js
 * import * as fs from 'fs';
 * ```
 *
 * All file system operations have synchronous and callback
 * forms, and are accessible using both CommonJS syntax and ES6 Modules (ESM).
 */
declare module "fs" {
  type Buffer = Uint8Array;
  import type { SystemError } from "bun";

  interface ObjectEncodingOptions {
    encoding?: BufferEncoding | null | undefined;
  }
  type EncodingOption =
    | ObjectEncodingOptions
    | BufferEncoding
    | undefined
    | null;
  type OpenMode = number | string;
  type Mode = number | string;
  interface StatsBase<T> {
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
  interface Stats extends StatsBase<number> {}
  /**
   * A `fs.Stats` object provides information about a file.
   *
   * Objects returned from {@link stat}, {@link lstat} and {@link fstat} and
   * their synchronous counterparts are of this type.
   * If `bigint` in the `options` passed to those methods is true, the numeric values
   * will be `bigint` instead of `number`, and the object will contain additional
   * nanosecond-precision properties suffixed with `Ns`.
   *
   * ```console
   * Stats {
   *   dev: 2114,
   *   ino: 48064969,
   *   mode: 33188,
   *   nlink: 1,
   *   uid: 85,
   *   gid: 100,
   *   rdev: 0,
   *   size: 527,
   *   blksize: 4096,
   *   blocks: 8,
   *   atimeMs: 1318289051000.1,
   *   mtimeMs: 1318289051000.1,
   *   ctimeMs: 1318289051000.1,
   *   birthtimeMs: 1318289051000.1,
   *   atime: Mon, 10 Oct 2011 23:24:11 GMT,
   *   mtime: Mon, 10 Oct 2011 23:24:11 GMT,
   *   ctime: Mon, 10 Oct 2011 23:24:11 GMT,
   *   birthtime: Mon, 10 Oct 2011 23:24:11 GMT }
   * ```
   *
   * `bigint` version:
   *
   * ```console
   * BigIntStats {
   *   dev: 2114n,
   *   ino: 48064969n,
   *   mode: 33188n,
   *   nlink: 1n,
   *   uid: 85n,
   *   gid: 100n,
   *   rdev: 0n,
   *   size: 527n,
   *   blksize: 4096n,
   *   blocks: 8n,
   *   atimeMs: 1318289051000n,
   *   mtimeMs: 1318289051000n,
   *   ctimeMs: 1318289051000n,
   *   birthtimeMs: 1318289051000n,
   *   atimeNs: 1318289051000000000n,
   *   mtimeNs: 1318289051000000000n,
   *   ctimeNs: 1318289051000000000n,
   *   birthtimeNs: 1318289051000000000n,
   *   atime: Mon, 10 Oct 2011 23:24:11 GMT,
   *   mtime: Mon, 10 Oct 2011 23:24:11 GMT,
   *   ctime: Mon, 10 Oct 2011 23:24:11 GMT,
   *   birthtime: Mon, 10 Oct 2011 23:24:11 GMT }
   * ```
   * @since v0.0.67
   */
  class Stats {}
  /**
   * A representation of a directory entry, which can be a file or a subdirectory
   * within the directory, as returned by reading from an `fs.Dir`. The
   * directory entry is a combination of the file name and file type pairs.
   *
   * Additionally, when {@link readdir} or {@link readdirSync} is called with
   * the `withFileTypes` option set to `true`, the resulting array is filled with `fs.Dirent` objects, rather than strings or `Buffer` s.
   * @since v0.0.67
   */
  class Dirent {
    /**
     * Returns `true` if the `fs.Dirent` object describes a regular file.
     * @since v0.0.67
     */
    isFile(): boolean;
    /**
     * Returns `true` if the `fs.Dirent` object describes a file system
     * directory.
     * @since v0.0.67
     */
    isDirectory(): boolean;
    /**
     * Returns `true` if the `fs.Dirent` object describes a block device.
     * @since v0.0.67
     */
    isBlockDevice(): boolean;
    /**
     * Returns `true` if the `fs.Dirent` object describes a character device.
     * @since v0.0.67
     */
    isCharacterDevice(): boolean;
    /**
     * Returns `true` if the `fs.Dirent` object describes a symbolic link.
     * @since v0.0.67
     */
    isSymbolicLink(): boolean;
    /**
     * Returns `true` if the `fs.Dirent` object describes a first-in-first-out
     * (FIFO) pipe.
     * @since v0.0.67
     */
    isFIFO(): boolean;
    /**
     * Returns `true` if the `fs.Dirent` object describes a socket.
     * @since v0.0.67
     */
    isSocket(): boolean;
    /**
     * The file name that this `fs.Dirent` object refers to. The type of this
     * value is determined by the `options.encoding` passed to {@link readdir} or {@link readdirSync}.
     * @since v0.0.67
     */
    name: string;
  }

  /**
   * Asynchronously rename file at `oldPath` to the pathname provided
   * as `newPath`. In the case that `newPath` already exists, it will
   * be overwritten. If there is a directory at `newPath`, an error will
   * be raised instead. No arguments other than a possible exception are
   * given to the completion callback.
   *
   * See also: [`rename(2)`](http://man7.org/linux/man-pages/man2/rename.2.html).
   *
   * ```js
   * import { rename } from 'fs';
   *
   * rename('oldFile.txt', 'newFile.txt', (err) => {
   *   if (err) throw err;
   *   console.log('Rename complete!');
   * });
   * ```
   * @since v0.0.67
   */
  function rename(
    oldPath: PathLike,
    newPath: PathLike,
    callback: NoParamCallback
  ): void;
  // namespace rename {
  //   /**
  //    * Asynchronous rename(2) - Change the name or location of a file or directory.
  //    * @param oldPath A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * URL support is _experimental_.
  //    * @param newPath A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * URL support is _experimental_.
  //    */
  //   function __promisify__(oldPath: PathLike, newPath: PathLike): Promise<void>;
  // }
  /**
   * Renames the file from `oldPath` to `newPath`. Returns `undefined`.
   *
   * See the POSIX [`rename(2)`](http://man7.org/linux/man-pages/man2/rename.2.html) documentation for more details.
   * @since v0.0.67
   */
  function renameSync(oldPath: PathLike, newPath: PathLike): void;
  /**
   * Truncates the file. No arguments other than a possible exception are
   * given to the completion callback. A file descriptor can also be passed as the
   * first argument. In this case, `fs.ftruncate()` is called.
   *
   * ```js
   * import { truncate } from 'fs';
   * // Assuming that 'path/file.txt' is a regular file.
   * truncate('path/file.txt', (err) => {
   *   if (err) throw err;
   *   console.log('path/file.txt was truncated');
   * });
   * ```
   *
   * Passing a file descriptor is deprecated and may result in an error being thrown
   * in the future.
   *
   * See the POSIX [`truncate(2)`](http://man7.org/linux/man-pages/man2/truncate.2.html) documentation for more details.
   * @since v0.0.67
   * @param [len=0]
   */
  function truncate(
    path: PathLike,
    len: number | undefined | null,
    callback: NoParamCallback
  ): void;
  /**
   * Asynchronous truncate(2) - Truncate a file to a specified length.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   */
  function truncate(path: PathLike, callback: NoParamCallback): void;
  // namespace truncate {
  //   /**
  //    * Asynchronous truncate(2) - Truncate a file to a specified length.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param len If not specified, defaults to `0`.
  //    */
  //   function __promisify__(path: PathLike, len?: number | null): Promise<void>;
  // }
  /**
   * Truncates the file. Returns `undefined`. A file descriptor can also be
   * passed as the first argument. In this case, `fs.ftruncateSync()` is called.
   *
   * Passing a file descriptor is deprecated and may result in an error being thrown
   * in the future.
   * @since v0.0.67
   * @param [len=0]
   */
  function truncateSync(path: PathLike, len?: number | null): void;
  /**
   * Truncates the file descriptor. No arguments other than a possible exception are
   * given to the completion callback.
   *
   * See the POSIX [`ftruncate(2)`](http://man7.org/linux/man-pages/man2/ftruncate.2.html) documentation for more detail.
   *
   * If the file referred to by the file descriptor was larger than `len` bytes, only
   * the first `len` bytes will be retained in the file.
   *
   * For example, the following program retains only the first four bytes of the
   * file:
   *
   * ```js
   * import { open, close, ftruncate } from 'fs';
   *
   * function closeFd(fd) {
   *   close(fd, (err) => {
   *     if (err) throw err;
   *   });
   * }
   *
   * open('temp.txt', 'r+', (err, fd) => {
   *   if (err) throw err;
   *
   *   try {
   *     ftruncate(fd, 4, (err) => {
   *       closeFd(fd);
   *       if (err) throw err;
   *     });
   *   } catch (err) {
   *     closeFd(fd);
   *     if (err) throw err;
   *   }
   * });
   * ```
   *
   * If the file previously was shorter than `len` bytes, it is extended, and the
   * extended part is filled with null bytes (`'\0'`):
   *
   * If `len` is negative then `0` will be used.
   * @since v0.0.67
   * @param [len=0]
   */
  function ftruncate(
    fd: number,
    len: number | undefined | null,
    callback: NoParamCallback
  ): void;
  /**
   * Asynchronous ftruncate(2) - Truncate a file to a specified length.
   * @param fd A file descriptor.
   */
  function ftruncate(fd: number, callback: NoParamCallback): void;
  // namespace ftruncate {
  //   /**
  //    * Asynchronous ftruncate(2) - Truncate a file to a specified length.
  //    * @param fd A file descriptor.
  //    * @param len If not specified, defaults to `0`.
  //    */
  //   function __promisify__(fd: number, len?: number | null): Promise<void>;
  // }
  /**
   * Truncates the file descriptor. Returns `undefined`.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link ftruncate}.
   * @since v0.0.67
   * @param [len=0]
   */
  function ftruncateSync(fd: number, len?: number | null): void;
  /**
   * Asynchronously changes owner and group of a file. No arguments other than a
   * possible exception are given to the completion callback.
   *
   * See the POSIX [`chown(2)`](http://man7.org/linux/man-pages/man2/chown.2.html) documentation for more detail.
   * @since v0.0.67
   */
  function chown(
    path: PathLike,
    uid: number,
    gid: number,
    callback: NoParamCallback
  ): void;
  // namespace chown {
  //   /**
  //    * Asynchronous chown(2) - Change ownership of a file.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     uid: number,
  //     gid: number
  //   ): Promise<void>;
  // }
  /**
   * Synchronously changes owner and group of a file. Returns `undefined`.
   * This is the synchronous version of {@link chown}.
   *
   * See the POSIX [`chown(2)`](http://man7.org/linux/man-pages/man2/chown.2.html) documentation for more detail.
   * @since v0.0.67
   */
  function chownSync(path: PathLike, uid: number, gid: number): void;
  /**
   * Sets the owner of the file. No arguments other than a possible exception are
   * given to the completion callback.
   *
   * See the POSIX [`fchown(2)`](http://man7.org/linux/man-pages/man2/fchown.2.html) documentation for more detail.
   * @since v0.0.67
   */
  function fchown(
    fd: number,
    uid: number,
    gid: number,
    callback: NoParamCallback
  ): void;
  // namespace fchown {
  //   /**
  //    * Asynchronous fchown(2) - Change ownership of a file.
  //    * @param fd A file descriptor.
  //    */
  //   function __promisify__(fd: number, uid: number, gid: number): Promise<void>;
  // }
  /**
   * Sets the owner of the file. Returns `undefined`.
   *
   * See the POSIX [`fchown(2)`](http://man7.org/linux/man-pages/man2/fchown.2.html) documentation for more detail.
   * @since v0.0.67
   * @param uid The file's new owner's user id.
   * @param gid The file's new group's group id.
   */
  function fchownSync(fd: number, uid: number, gid: number): void;
  /**
   * Set the owner of the symbolic link. No arguments other than a possible
   * exception are given to the completion callback.
   *
   * See the POSIX [`lchown(2)`](http://man7.org/linux/man-pages/man2/lchown.2.html) documentation for more detail.
   */
  function lchown(
    path: PathLike,
    uid: number,
    gid: number,
    callback: NoParamCallback
  ): void;
  // namespace lchown {
  //   /**
  //    * Asynchronous lchown(2) - Change ownership of a file. Does not dereference symbolic links.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     uid: number,
  //     gid: number
  //   ): Promise<void>;
  // }
  /**
   * Set the owner for the path. Returns `undefined`.
   *
   * See the POSIX [`lchown(2)`](http://man7.org/linux/man-pages/man2/lchown.2.html) documentation for more details.
   * @param uid The file's new owner's user id.
   * @param gid The file's new group's group id.
   */
  function lchownSync(path: PathLike, uid: number, gid: number): void;
  /**
   * Changes the access and modification times of a file in the same way as {@link utimes}, with the difference that if the path refers to a symbolic
   * link, then the link is not dereferenced: instead, the timestamps of the
   * symbolic link itself are changed.
   *
   * No arguments other than a possible exception are given to the completion
   * callback.
   * @since v0.0.67
   */
  function lutimes(
    path: PathLike,
    atime: TimeLike,
    mtime: TimeLike,
    callback: NoParamCallback
  ): void;
  // namespace lutimes {
  //   /**
  //    * Changes the access and modification times of a file in the same way as `fsPromises.utimes()`,
  //    * with the difference that if the path refers to a symbolic link, then the link is not
  //    * dereferenced: instead, the timestamps of the symbolic link itself are changed.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param atime The last access time. If a string is provided, it will be coerced to number.
  //    * @param mtime The last modified time. If a string is provided, it will be coerced to number.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     atime: TimeLike,
  //     mtime: TimeLike
  //   ): Promise<void>;
  // }
  /**
   * Change the file system timestamps of the symbolic link referenced by `path`.
   * Returns `undefined`, or throws an exception when parameters are incorrect or
   * the operation fails. This is the synchronous version of {@link lutimes}.
   * @since v0.0.67
   */
  function lutimesSync(path: PathLike, atime: TimeLike, mtime: TimeLike): void;
  /**
   * Asynchronously changes the permissions of a file. No arguments other than a
   * possible exception are given to the completion callback.
   *
   * See the POSIX [`chmod(2)`](http://man7.org/linux/man-pages/man2/chmod.2.html) documentation for more detail.
   *
   * ```js
   * import { chmod } from 'fs';
   *
   * chmod('my_file.txt', 0o775, (err) => {
   *   if (err) throw err;
   *   console.log('The permissions for file "my_file.txt" have been changed!');
   * });
   * ```
   * @since v0.0.67
   */
  function chmod(path: PathLike, mode: Mode, callback: NoParamCallback): void;
  // namespace chmod {
  //   /**
  //    * Asynchronous chmod(2) - Change permissions of a file.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param mode A file mode. If a string is passed, it is parsed as an octal integer.
  //    */
  //   function __promisify__(path: PathLike, mode: Mode): Promise<void>;
  // }
  /**
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link chmod}.
   *
   * See the POSIX [`chmod(2)`](http://man7.org/linux/man-pages/man2/chmod.2.html) documentation for more detail.
   * @since v0.0.67
   */
  function chmodSync(path: PathLike, mode: Mode): void;
  /**
   * Sets the permissions on the file. No arguments other than a possible exception
   * are given to the completion callback.
   *
   * See the POSIX [`fchmod(2)`](http://man7.org/linux/man-pages/man2/fchmod.2.html) documentation for more detail.
   * @since v0.0.67
   */
  function fchmod(fd: number, mode: Mode, callback: NoParamCallback): void;
  // namespace fchmod {
  //   /**
  //    * Asynchronous fchmod(2) - Change permissions of a file.
  //    * @param fd A file descriptor.
  //    * @param mode A file mode. If a string is passed, it is parsed as an octal integer.
  //    */
  //   function __promisify__(fd: number, mode: Mode): Promise<void>;
  // }
  /**
   * Sets the permissions on the file. Returns `undefined`.
   *
   * See the POSIX [`fchmod(2)`](http://man7.org/linux/man-pages/man2/fchmod.2.html) documentation for more detail.
   * @since v0.0.67
   */
  function fchmodSync(fd: number, mode: Mode): void;
  /**
   * Changes the permissions on a symbolic link. No arguments other than a possible
   * exception are given to the completion callback.
   *
   * This method is only implemented on macOS.
   *
   * See the POSIX [`lchmod(2)`](https://www.freebsd.org/cgi/man.cgi?query=lchmod&sektion=2) documentation for more detail.
   * @deprecated Since v0.4.7
   */
  function lchmod(path: PathLike, mode: Mode, callback: NoParamCallback): void;
  // /** @deprecated */
  // namespace lchmod {
  //   /**
  //    * Asynchronous lchmod(2) - Change permissions of a file. Does not dereference symbolic links.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param mode A file mode. If a string is passed, it is parsed as an octal integer.
  //    */
  //   function __promisify__(path: PathLike, mode: Mode): Promise<void>;
  // }
  /**
   * Changes the permissions on a symbolic link. Returns `undefined`.
   *
   * This method is only implemented on macOS.
   *
   * See the POSIX [`lchmod(2)`](https://www.freebsd.org/cgi/man.cgi?query=lchmod&sektion=2) documentation for more detail.
   * @deprecated Since v0.4.7
   */
  function lchmodSync(path: PathLike, mode: Mode): void;
  /**
   * Asynchronous [`stat(2)`](http://man7.org/linux/man-pages/man2/stat.2.html). The callback gets two arguments `(err, stats)` where`stats` is an `fs.Stats` object.
   *
   * In case of an error, the `err.code` will be one of `Common System Errors`.
   *
   * Using `fs.stat()` to check for the existence of a file before calling`fs.open()`, `fs.readFile()` or `fs.writeFile()` is not recommended.
   * Instead, user code should open/read/write the file directly and handle the
   * error raised if the file is not available.
   *
   * To check if a file exists without manipulating it afterwards, {@link access} is recommended.
   *
   * For example, given the following directory structure:
   *
   * ```text
   * - txtDir
   * -- file.txt
   * - app.js
   * ```
   *
   * The next program will check for the stats of the given paths:
   *
   * ```js
   * import { stat } from 'fs';
   *
   * const pathsToCheck = ['./txtDir', './txtDir/file.txt'];
   *
   * for (let i = 0; i < pathsToCheck.length; i++) {
   *   stat(pathsToCheck[i], (err, stats) => {
   *     console.log(stats.isDirectory());
   *     console.log(stats);
   *   });
   * }
   * ```
   *
   * The resulting output will resemble:
   *
   * ```console
   * true
   * Stats {
   *   dev: 16777220,
   *   mode: 16877,
   *   nlink: 3,
   *   uid: 501,
   *   gid: 20,
   *   rdev: 0,
   *   blksize: 4096,
   *   ino: 14214262,
   *   size: 96,
   *   blocks: 0,
   *   atimeMs: 1561174653071.963,
   *   mtimeMs: 1561174614583.3518,
   *   ctimeMs: 1561174626623.5366,
   *   birthtimeMs: 1561174126937.2893,
   *   atime: 2019-06-22T03:37:33.072Z,
   *   mtime: 2019-06-22T03:36:54.583Z,
   *   ctime: 2019-06-22T03:37:06.624Z,
   *   birthtime: 2019-06-22T03:28:46.937Z
   * }
   * false
   * Stats {
   *   dev: 16777220,
   *   mode: 33188,
   *   nlink: 1,
   *   uid: 501,
   *   gid: 20,
   *   rdev: 0,
   *   blksize: 4096,
   *   ino: 14214074,
   *   size: 8,
   *   blocks: 8,
   *   atimeMs: 1561174616618.8555,
   *   mtimeMs: 1561174614584,
   *   ctimeMs: 1561174614583.8145,
   *   birthtimeMs: 1561174007710.7478,
   *   atime: 2019-06-22T03:36:56.619Z,
   *   mtime: 2019-06-22T03:36:54.584Z,
   *   ctime: 2019-06-22T03:36:54.584Z,
   *   birthtime: 2019-06-22T03:26:47.711Z
   * }
   * ```
   * @since v0.0.67
   */
  function stat(
    path: PathLike,
    callback: (err: SystemError | null, stats: Stats) => void
  ): void;
  function stat(
    path: PathLike,
    options:
      | (StatOptions & {
          bigint?: false | undefined;
        })
      | undefined,
    callback: (err: SystemError | null, stats: Stats) => void
  ): void;
  function stat(
    path: PathLike,
    options: StatOptions & {
      bigint: true;
    },
    callback: (err: SystemError | null, stats: BigIntStats) => void
  ): void;
  function stat(
    path: PathLike,
    options: StatOptions | undefined,
    callback: (err: SystemError | null, stats: Stats | BigIntStats) => void
  ): void;
  // namespace stat {
  //   /**
  //    * Asynchronous stat(2) - Get file status.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?: StatOptions & {
  //       bigint?: false | undefined;
  //     }
  //   ): Promise<Stats>;
  //   function __promisify__(
  //     path: PathLike,
  //     options: StatOptions & {
  //       bigint: true;
  //     }
  //   ): Promise<BigIntStats>;
  //   function __promisify__(
  //     path: PathLike,
  //     options?: StatOptions
  //   ): Promise<Stats | BigIntStats>;
  // }
  // tslint:disable-next-line:unified-signatures
  interface StatSyncFn extends Function {
    // tslint:disable-next-line:unified-signatures
    (path: PathLike, options?: undefined): Stats;
    (
      path: PathLike,
      options?: StatSyncOptions & {
        bigint?: false | undefined;
        throwIfNoEntry: false;
      }
    ): Stats | undefined;
    (
      path: PathLike,
      options: StatSyncOptions & {
        bigint: true;
        throwIfNoEntry: false;
      }
    ): BigIntStats | undefined;
    // tslint:disable-next-line:unified-signatures
    (
      path: PathLike,
      // tslint:disable-next-line:unified-signatures
      options?: StatSyncOptions & {
        bigint?: false | undefined;
      }
    ): Stats;
    (
      path: PathLike,
      options: StatSyncOptions & {
        bigint: true;
      }
    ): BigIntStats;
    (
      path: PathLike,
      options: StatSyncOptions & {
        bigint: boolean;
        throwIfNoEntry?: false | undefined;
      }
    ): Stats | BigIntStats;
    (path: PathLike, options?: StatSyncOptions):
      | Stats
      | BigIntStats
      | undefined;
  }
  /**
   * Synchronous stat(2) - Get file status.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   */
  var statSync: StatSyncFn;
  /**
   * Invokes the callback with the `fs.Stats` for the file descriptor.
   *
   * See the POSIX [`fstat(2)`](http://man7.org/linux/man-pages/man2/fstat.2.html) documentation for more detail.
   * @since v0.0.67
   */
  function fstat(
    fd: number,
    callback: (err: SystemError | null, stats: Stats) => void
  ): void;
  function fstat(
    fd: number,
    options:
      | (StatOptions & {
          bigint?: false | undefined;
        })
      | undefined,
    callback: (err: SystemError | null, stats: Stats) => void
  ): void;
  function fstat(
    fd: number,
    options: StatOptions & {
      bigint: true;
    },
    callback: (err: SystemError | null, stats: BigIntStats) => void
  ): void;
  function fstat(
    fd: number,
    options: StatOptions | undefined,
    callback: (err: SystemError | null, stats: Stats | BigIntStats) => void
  ): void;
  // namespace fstat {
  //   /**
  //    * Asynchronous fstat(2) - Get file status.
  //    * @param fd A file descriptor.
  //    */
  //   function __promisify__(
  //     fd: number,
  //     options?: StatOptions & {
  //       bigint?: false | undefined;
  //     }
  //   ): Promise<Stats>;
  //   function __promisify__(
  //     fd: number,
  //     options: StatOptions & {
  //       bigint: true;
  //     }
  //   ): Promise<BigIntStats>;
  //   function __promisify__(
  //     fd: number,
  //     options?: StatOptions
  //   ): Promise<Stats | BigIntStats>;
  // }
  /**
   * Retrieves the `fs.Stats` for the file descriptor.
   *
   * See the POSIX [`fstat(2)`](http://man7.org/linux/man-pages/man2/fstat.2.html) documentation for more detail.
   * @since v0.0.67
   */
  function fstatSync(
    fd: number,
    options?: StatOptions & {
      bigint?: false | undefined;
    }
  ): Stats;
  function fstatSync(
    fd: number,
    options: StatOptions & {
      bigint: true;
    }
  ): BigIntStats;
  function fstatSync(fd: number, options?: StatOptions): Stats | BigIntStats;
  /**
   * Retrieves the `fs.Stats` for the symbolic link referred to by the path.
   * The callback gets two arguments `(err, stats)` where `stats` is a `fs.Stats` object. `lstat()` is identical to `stat()`, except that if `path` is a symbolic
   * link, then the link itself is stat-ed, not the file that it refers to.
   *
   * See the POSIX [`lstat(2)`](http://man7.org/linux/man-pages/man2/lstat.2.html) documentation for more details.
   * @since v0.0.67
   */
  function lstat(
    path: PathLike,
    callback: (err: SystemError | null, stats: Stats) => void
  ): void;
  function lstat(
    path: PathLike,
    options:
      | (StatOptions & {
          bigint?: false | undefined;
        })
      | undefined,
    callback: (err: SystemError | null, stats: Stats) => void
  ): void;
  function lstat(
    path: PathLike,
    options: StatOptions & {
      bigint: true;
    },
    callback: (err: SystemError | null, stats: BigIntStats) => void
  ): void;
  function lstat(
    path: PathLike,
    options: StatOptions | undefined,
    callback: (err: SystemError | null, stats: Stats | BigIntStats) => void
  ): void;
  // namespace lstat {
  //   /**
  //    * Asynchronous lstat(2) - Get file status. Does not dereference symbolic links.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?: StatOptions & {
  //       bigint?: false | undefined;
  //     }
  //   ): Promise<Stats>;
  //   function __promisify__(
  //     path: PathLike,
  //     options: StatOptions & {
  //       bigint: true;
  //     }
  //   ): Promise<BigIntStats>;
  //   function __promisify__(
  //     path: PathLike,
  //     options?: StatOptions
  //   ): Promise<Stats | BigIntStats>;
  // }
  /**
   * Synchronous lstat(2) - Get file status. Does not dereference symbolic links.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   */
  var lstatSync: StatSyncFn;
  /**
   * Creates a new link from the `existingPath` to the `newPath`. See the POSIX [`link(2)`](http://man7.org/linux/man-pages/man2/link.2.html) documentation for more detail. No arguments other than
   * a possible
   * exception are given to the completion callback.
   * @since v0.0.67
   */
  function link(
    existingPath: PathLike,
    newPath: PathLike,
    callback: NoParamCallback
  ): void;
  // namespace link {
  //   /**
  //    * Asynchronous link(2) - Create a new link (also known as a hard link) to an existing file.
  //    * @param existingPath A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param newPath A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    */
  //   function __promisify__(
  //     existingPath: PathLike,
  //     newPath: PathLike
  //   ): Promise<void>;
  // }
  /**
   * Creates a new link from the `existingPath` to the `newPath`. See the POSIX [`link(2)`](http://man7.org/linux/man-pages/man2/link.2.html) documentation for more detail. Returns `undefined`.
   * @since v0.0.67
   */
  function linkSync(existingPath: PathLike, newPath: PathLike): void;
  /**
   * Creates the link called `path` pointing to `target`. No arguments other than a
   * possible exception are given to the completion callback.
   *
   * See the POSIX [`symlink(2)`](http://man7.org/linux/man-pages/man2/symlink.2.html) documentation for more details.
   *
   * The `type` argument is only available on Windows and ignored on other platforms.
   * It can be set to `'dir'`, `'file'`, or `'junction'`. If the `type` argument is
   * not set, Node.js will autodetect `target` type and use `'file'` or `'dir'`. If
   * the `target` does not exist, `'file'` will be used. Windows junction points
   * require the destination path to be absolute. When using `'junction'`, the`target` argument will automatically be normalized to absolute path.
   *
   * Relative targets are relative to the link’s parent directory.
   *
   * ```js
   * import { symlink } from 'fs';
   *
   * symlink('./mew', './example/mewtwo', callback);
   * ```
   *
   * The above example creates a symbolic link `mewtwo` in the `example` which points
   * to `mew` in the same directory:
   *
   * ```bash
   * $ tree example/
   * example/
   * ├── mew
   * └── mewtwo -> ./mew
   * ```
   * @since v0.0.67
   */
  function symlink(
    target: PathLike,
    path: PathLike,
    type: "symlink" | "junction" | undefined | null,
    callback: NoParamCallback
  ): void;
  /**
   * Asynchronous symlink(2) - Create a new symbolic link to an existing file.
   * @param target A path to an existing file. If a URL is provided, it must use the `file:` protocol.
   * @param path A path to the new symlink. If a URL is provided, it must use the `file:` protocol.
   */
  function symlink(
    target: PathLike,
    path: PathLike,
    callback: NoParamCallback
  ): void;
  // namespace symlink {
  //   /**
  //    * Asynchronous symlink(2) - Create a new symbolic link to an existing file.
  //    * @param target A path to an existing file. If a URL is provided, it must use the `file:` protocol.
  //    * @param path A path to the new symlink. If a URL is provided, it must use the `file:` protocol.
  //    * @param type May be set to `'dir'`, `'file'`, or `'junction'` (default is `'file'`) and is only available on Windows (ignored on other platforms).
  //    * When using `'junction'`, the `target` argument will automatically be normalized to an absolute path.
  //    */
  //   function __promisify__(
  //     target: PathLike,
  //     path: PathLike,
  //     type?: string | null
  //   ): Promise<void>;
  //   type Type = "dir" | "file" | "junction";
  // }
  /**
   * Returns `undefined`.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link symlink}.
   * @since v0.0.67
   */
  function symlinkSync(
    target: PathLike,
    path: PathLike,
    type?: "symlink" | "junction" | null
  ): void;
  /**
   * Reads the contents of the symbolic link referred to by `path`. The callback gets
   * two arguments `(err, linkString)`.
   *
   * See the POSIX [`readlink(2)`](http://man7.org/linux/man-pages/man2/readlink.2.html) documentation for more details.
   *
   * The optional `options` argument can be a string specifying an encoding, or an
   * object with an `encoding` property specifying the character encoding to use for
   * the link path passed to the callback. If the `encoding` is set to `'buffer'`,
   * the link path returned will be passed as a `Buffer` object.
   * @since v0.0.67
   */
  function readlink(
    path: PathLike,
    options: EncodingOption,
    callback: (err: SystemError | null, linkString: string) => void
  ): void;
  /**
   * Asynchronous readlink(2) - read value of a symbolic link.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  // tslint:disable-next-line:unified-signatures
  function readlink(
    path: PathLike,
    options: BufferEncodingOption,
    callback: (err: SystemError | null, linkString: Buffer) => void
  ): void;
  /**
   * Asynchronous readlink(2) - read value of a symbolic link.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  // tslint:disable-next-line:unified-signatures
  function readlink(
    path: PathLike,
    options: EncodingOption,
    // tslint:disable-next-line:unified-signatures
    callback: (err: SystemError | null, linkString: string | Buffer) => void
  ): void;
  /**
   * Asynchronous readlink(2) - read value of a symbolic link.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   */
  // tslint:disable-next-line:unified-signatures
  function readlink(
    path: PathLike,
    callback: (err: SystemError | null, linkString: string) => void
  ): void;
  // namespace readlink {
  //   /**
  //    * Asynchronous readlink(2) - read value of a symbolic link.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?: EncodingOption
  //   ): Promise<string>;
  //   /**
  //    * Asynchronous readlink(2) - read value of a symbolic link.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options: BufferEncodingOption
  //   ): Promise<Buffer>;
  //   /**
  //    * Asynchronous readlink(2) - read value of a symbolic link.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?: EncodingOption
  //   ): Promise<string | Buffer>;
  // }
  /**
   * Returns the symbolic link's string value.
   *
   * See the POSIX [`readlink(2)`](http://man7.org/linux/man-pages/man2/readlink.2.html) documentation for more details.
   *
   * The optional `options` argument can be a string specifying an encoding, or an
   * object with an `encoding` property specifying the character encoding to use for
   * the link path returned. If the `encoding` is set to `'buffer'`,
   * the link path returned will be passed as a `Buffer` object.
   * @since v0.0.67
   */
  function readlinkSync(path: PathLike, options?: EncodingOption): string;
  /**
   * Synchronous readlink(2) - read value of a symbolic link.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function readlinkSync(path: PathLike, options: BufferEncodingOption): Buffer;
  /**
   * Synchronous readlink(2) - read value of a symbolic link.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function readlinkSync(
    path: PathLike,
    options?: EncodingOption
  ): string | Buffer;
  /**
   * Asynchronously computes the canonical pathname by resolving `.`, `..` and
   * symbolic links.
   *
   * A canonical pathname is not necessarily unique. Hard links and bind mounts can
   * expose a file system entity through many pathnames.
   *
   * This function behaves like [`realpath(3)`](http://man7.org/linux/man-pages/man3/realpath.3.html), with some exceptions:
   *
   * 1. No case conversion is performed on case-insensitive file systems.
   * 2. The maximum number of symbolic links is platform-independent and generally
   * (much) higher than what the native [`realpath(3)`](http://man7.org/linux/man-pages/man3/realpath.3.html) implementation supports.
   *
   * The `callback` gets two arguments `(err, resolvedPath)`. May use `process.cwd`to resolve relative paths.
   *
   * Only paths that can be converted to UTF8 strings are supported.
   *
   * The optional `options` argument can be a string specifying an encoding, or an
   * object with an `encoding` property specifying the character encoding to use for
   * the path passed to the callback. If the `encoding` is set to `'buffer'`,
   * the path returned will be passed as a `Buffer` object.
   *
   * If `path` resolves to a socket or a pipe, the function will return a system
   * dependent name for that object.
   * @since v0.0.67
   */
  function realpath(
    path: PathLike,
    options: EncodingOption,
    callback: (err: SystemError | null, resolvedPath: string) => void
  ): void;
  /**
   * Asynchronous realpath(3) - return the canonicalized absolute pathname.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  // tslint:disable-next-line:unified-signatures
  function realpath(
    path: PathLike,
    options: BufferEncodingOption,
    callback: (err: SystemError | null, resolvedPath: Buffer) => void
  ): void;
  /**
   * Asynchronous realpath(3) - return the canonicalized absolute pathname.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  // tslint:disable-next-line:unified-signatures
  function realpath(
    path: PathLike,
    options: EncodingOption,
    // tslint:disable-next-line:unified-signatures
    callback: (err: SystemError | null, resolvedPath: string | Buffer) => void
  ): void;
  /**
   * Asynchronous realpath(3) - return the canonicalized absolute pathname.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   */
  // tslint:disable-next-line:unified-signatures
  function realpath(
    path: PathLike,
    callback: (err: SystemError | null, resolvedPath: string) => void
  ): void;
  // namespace realpath {
  //   /**
  //    * Asynchronous realpath(3) - return the canonicalized absolute pathname.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?: EncodingOption
  //   ): Promise<string>;
  //   /**
  //    * Asynchronous realpath(3) - return the canonicalized absolute pathname.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options: BufferEncodingOption
  //   ): Promise<Buffer>;
  //   /**
  //    * Asynchronous realpath(3) - return the canonicalized absolute pathname.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?: EncodingOption
  //   ): Promise<string | Buffer>;
  //   /**
  //    * Asynchronous [`realpath(3)`](http://man7.org/linux/man-pages/man3/realpath.3.html).
  //    *
  //    * The `callback` gets two arguments `(err, resolvedPath)`.
  //    *
  //    * Only paths that can be converted to UTF8 strings are supported.
  //    *
  //    * The optional `options` argument can be a string specifying an encoding, or an
  //    * object with an `encoding` property specifying the character encoding to use for
  //    * the path passed to the callback. If the `encoding` is set to `'buffer'`,
  //    * the path returned will be passed as a `Buffer` object.
  //    *
  //    * On Linux, when Node.js is linked against musl libc, the procfs file system must
  //    * be mounted on `/proc` in order for this function to work. Glibc does not have
  //    * this restriction.
  //    * @since v0.0.67
  //    */
  //   function native(
  //     path: PathLike,
  //     options: EncodingOption,
  //     // tslint:disable-next-line:unified-signatures
  //     callback: (err: SystemError | null, resolvedPath: string) => void
  //   ): void;
  //   function native(
  //     path: PathLike,
  //     options: BufferEncodingOption,
  //     // tslint:disable-next-line:unified-signatures
  //     callback: (err: SystemError | null, resolvedPath: Buffer) => void
  //   ): void;
  //   function native(
  //     path: PathLike,
  //     options: EncodingOption,
  //     // tslint:disable-next-line:unified-signatures
  //     callback: (err: SystemError | null, resolvedPath: string | Buffer) => void
  //   ): void;
  //   function native(
  //     path: PathLike,
  //     callback: (err: SystemError | null, resolvedPath: string) => void
  //   ): void;
  // }
  /**
   * Returns the resolved pathname.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link realpath}.
   * @since v0.0.67
   */
  function realpathSync(path: PathLike, options?: EncodingOption): string;
  /**
   * Synchronous realpath(3) - return the canonicalized absolute pathname.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function realpathSync(path: PathLike, options: BufferEncodingOption): Buffer;
  /**
   * Synchronous realpath(3) - return the canonicalized absolute pathname.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function realpathSync(
    path: PathLike,
    options?: EncodingOption
  ): string | Buffer;
  namespace realpathSync {
    function native(path: PathLike, options?: EncodingOption): string;
    function native(path: PathLike, options: BufferEncodingOption): Buffer;
    function native(path: PathLike, options?: EncodingOption): string | Buffer;
  }
  /**
   * Asynchronously removes a file or symbolic link. No arguments other than a
   * possible exception are given to the completion callback.
   *
   * ```js
   * import { unlink } from 'fs';
   * // Assuming that 'path/file.txt' is a regular file.
   * unlink('path/file.txt', (err) => {
   *   if (err) throw err;
   *   console.log('path/file.txt was deleted');
   * });
   * ```
   *
   * `fs.unlink()` will not work on a directory, empty or otherwise. To remove a
   * directory, use {@link rmdir}.
   *
   * See the POSIX [`unlink(2)`](http://man7.org/linux/man-pages/man2/unlink.2.html) documentation for more details.
   * @since v0.0.67
   */
  function unlink(path: PathLike, callback: NoParamCallback): void;
  // namespace unlink {
  //   /**
  //    * Asynchronous unlink(2) - delete a name and possibly the file it refers to.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    */
  //   function __promisify__(path: PathLike): Promise<void>;
  // }
  /**
   * Synchronous [`unlink(2)`](http://man7.org/linux/man-pages/man2/unlink.2.html). Returns `undefined`.
   * @since v0.0.67
   */
  function unlinkSync(path: PathLike): void;
  interface RmDirOptions {
    /**
     * If an `EBUSY`, `EMFILE`, `ENFILE`, `ENOTEMPTY`, or
     * `EPERM` error is encountered, Node.js will retry the operation with a linear
     * backoff wait of `retryDelay` ms longer on each try. This option represents the
     * number of retries. This option is ignored if the `recursive` option is not
     * `true`.
     * @default 0
     */
    maxRetries?: number | undefined;
    /**
     * @deprecated since v14.14.0 In future versions of Node.js and will trigger a warning
     * `fs.rmdir(path, { recursive: true })` will throw if `path` does not exist or is a file.
     * Use `fs.rm(path, { recursive: true, force: true })` instead.
     *
     * If `true`, perform a recursive directory removal. In
     * recursive mode soperations are retried on failure.
     * @default false
     */
    recursive?: boolean | undefined;
    /**
     * The amount of time in milliseconds to wait between retries.
     * This option is ignored if the `recursive` option is not `true`.
     * @default 100
     */
    retryDelay?: number | undefined;
  }
  /**
   * Asynchronous [`rmdir(2)`](http://man7.org/linux/man-pages/man2/rmdir.2.html). No arguments other than a possible exception are given
   * to the completion callback.
   *
   * Using `fs.rmdir()` on a file (not a directory) results in an `ENOENT` error on
   * Windows and an `ENOTDIR` error on POSIX.
   *
   * To get a behavior similar to the `rm -rf` Unix command, use {@link rm} with options `{ recursive: true, force: true }`.
   * @since v0.0.67
   */
  function rmdir(path: PathLike, callback: NoParamCallback): void;
  function rmdir(
    path: PathLike,
    options: RmDirOptions,
    callback: NoParamCallback
  ): void;
  // namespace rmdir {
  //   /**
  //    * Asynchronous rmdir(2) - delete a directory.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?: RmDirOptions
  //   ): Promise<void>;
  // }
  /**
   * Synchronous [`rmdir(2)`](http://man7.org/linux/man-pages/man2/rmdir.2.html). Returns `undefined`.
   *
   * Using `fs.rmdirSync()` on a file (not a directory) results in an `ENOENT` error
   * on Windows and an `ENOTDIR` error on POSIX.
   *
   * To get a behavior similar to the `rm -rf` Unix command, use {@link rmSync} with options `{ recursive: true, force: true }`.
   * @since v0.0.67
   */
  function rmdirSync(path: PathLike, options?: RmDirOptions): void;
  interface RmOptions {
    /**
     * When `true`, exceptions will be ignored if `path` does not exist.
     * @default false
     */
    force?: boolean | undefined;
    /**
     * If an `EBUSY`, `EMFILE`, `ENFILE`, `ENOTEMPTY`, or
     * `EPERM` error is encountered, Node.js will retry the operation with a linear
     * backoff wait of `retryDelay` ms longer on each try. This option represents the
     * number of retries. This option is ignored if the `recursive` option is not
     * `true`.
     * @default 0
     */
    maxRetries?: number | undefined;
    /**
     * If `true`, perform a recursive directory removal. In
     * recursive mode, operations are retried on failure.
     * @default false
     */
    recursive?: boolean | undefined;
    /**
     * The amount of time in milliseconds to wait between retries.
     * This option is ignored if the `recursive` option is not `true`.
     * @default 100
     */
    retryDelay?: number | undefined;
  }
  interface MakeDirectoryOptions {
    /**
     * Indicates whether parent folders should be created.
     * If a folder was created, the path to the first created folder will be returned.
     * @default false
     */
    recursive?: boolean | undefined;
    /**
     * A file mode. If a string is passed, it is parsed as an octal integer. If not specified
     * @default 0o777
     */
    mode?: Mode | undefined;
  }
  /**
   * Asynchronously creates a directory.
   *
   * The callback is given a possible exception and, if `recursive` is `true`, the
   * first directory path created, `(err[, path])`.`path` can still be `undefined` when `recursive` is `true`, if no directory was
   * created.
   *
   * The optional `options` argument can be an integer specifying `mode` (permission
   * and sticky bits), or an object with a `mode` property and a `recursive`property indicating whether parent directories should be created. Calling`fs.mkdir()` when `path` is a directory that
   * exists results in an error only
   * when `recursive` is false.
   *
   * ```js
   * import { mkdir } from 'fs';
   *
   * // Creates /tmp/a/apple, regardless of whether `/tmp` and /tmp/a exist.
   * mkdir('/tmp/a/apple', { recursive: true }, (err) => {
   *   if (err) throw err;
   * });
   * ```
   *
   * On Windows, using `fs.mkdir()` on the root directory even with recursion will
   * result in an error:
   *
   * ```js
   * import { mkdir } from 'fs';
   *
   * mkdir('/', { recursive: true }, (err) => {
   *   // => [Error: EPERM: operation not permitted, mkdir 'C:\']
   * });
   * ```
   *
   * See the POSIX [`mkdir(2)`](http://man7.org/linux/man-pages/man2/mkdir.2.html) documentation for more details.
   * @since v0.0.67
   */
  function mkdir(
    path: PathLike,
    options: MakeDirectoryOptions & {
      recursive: true;
    },
    callback: (err: SystemError | null, path?: string) => void
  ): void;
  /**
   * Asynchronous mkdir(2) - create a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
   * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
   */
  function mkdir(
    path: PathLike,
    options:
      | Mode
      | (MakeDirectoryOptions & {
          recursive?: false | undefined;
        })
      | null
      | undefined,
    callback: NoParamCallback
  ): void;
  /**
   * Asynchronous mkdir(2) - create a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
   * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
   */
  function mkdir(
    path: PathLike,
    // tslint:disable-next-line:unified-signatures
    options: Mode | MakeDirectoryOptions | null | undefined,
    callback: (err: SystemError | null, path?: string) => void
  ): void;
  /**
   * Asynchronous mkdir(2) - create a directory with a mode of `0o777`.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   */
  function mkdir(path: PathLike, callback: NoParamCallback): void;
  // namespace mkdir {
  //   /**
  //    * Asynchronous mkdir(2) - create a directory.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
  //    * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options: MakeDirectoryOptions & {
  //       recursive: true;
  //     }
  //   ): Promise<string | undefined>;
  //   /**
  //    * Asynchronous mkdir(2) - create a directory.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
  //    * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?:
  //       | Mode
  //       | (MakeDirectoryOptions & {
  //           recursive?: false | undefined;
  //         })
  //       | null
  //   ): Promise<void>;
  //   /**
  //    * Asynchronous mkdir(2) - create a directory.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
  //    * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?: Mode | MakeDirectoryOptions | null
  //   ): Promise<string | undefined>;
  // }
  /**
   * Synchronously creates a directory. Returns `undefined`, or if `recursive` is`true`, the first directory path created.
   * This is the synchronous version of {@link mkdir}.
   *
   * See the POSIX [`mkdir(2)`](http://man7.org/linux/man-pages/man2/mkdir.2.html) documentation for more details.
   * @since v0.0.67
   */
  function mkdirSync(
    path: PathLike,
    options: MakeDirectoryOptions & {
      recursive: true;
    }
  ): string | undefined;
  /**
   * Synchronous mkdir(2) - create a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
   * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
   */
  function mkdirSync(
    path: PathLike,
    options?:
      | Mode
      | (MakeDirectoryOptions & {
          recursive?: false | undefined;
        })
      | null
  ): void;
  /**
   * Synchronous mkdir(2) - create a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options Either the file mode, or an object optionally specifying the file mode and whether parent folders
   * should be created. If a string is passed, it is parsed as an octal integer. If not specified, defaults to `0o777`.
   */
  function mkdirSync(
    path: PathLike,
    options?: Mode | MakeDirectoryOptions | null
  ): string | undefined;
  /**
   * Creates a unique temporary directory.
   *
   * Generates six random characters to be appended behind a required`prefix` to create a unique temporary directory. Due to platform
   * inconsistencies, avoid trailing `X` characters in `prefix`. Some platforms,
   * notably the BSDs, can return more than six random characters, and replace
   * trailing `X` characters in `prefix` with random characters.
   *
   * The created directory path is passed as a string to the callback's second
   * parameter.
   *
   * The optional `options` argument can be a string specifying an encoding, or an
   * object with an `encoding` property specifying the character encoding to use.
   *
   * ```js
   * import { mkdtemp } from 'fs';
   *
   * mkdtemp(path.join(os.tmpdir(), 'foo-'), (err, directory) => {
   *   if (err) throw err;
   *   console.log(directory);
   *   // Prints: /tmp/foo-itXde2 or C:\Users\...\AppData\Local\Temp\foo-itXde2
   * });
   * ```
   *
   * The `fs.mkdtemp()` method will append the six randomly selected characters
   * directly to the `prefix` string. For instance, given a directory `/tmp`, if the
   * intention is to create a temporary directory _within_`/tmp`, the `prefix`must end with a trailing platform-specific path separator
   * (`require('path').sep`).
   *
   * ```js
   * import { tmpdir } from 'os';
   * import { mkdtemp } from 'fs';
   *
   * // The parent directory for the new temporary directory
   * const tmpDir = tmpdir();
   *
   * // This method is *INCORRECT*:
   * mkdtemp(tmpDir, (err, directory) => {
   *   if (err) throw err;
   *   console.log(directory);
   *   // Will print something similar to `/tmpabc123`.
   *   // A new temporary directory is created at the file system root
   *   // rather than *within* the /tmp directory.
   * });
   *
   * // This method is *CORRECT*:
   * import { sep } from 'path';
   * mkdtemp(`${tmpDir}${sep}`, (err, directory) => {
   *   if (err) throw err;
   *   console.log(directory);
   *   // Will print something similar to `/tmp/abc123`.
   *   // A new temporary directory is created within
   *   // the /tmp directory.
   * });
   * ```
   * @since v0.0.67
   */
  function mkdtemp(
    prefix: string,
    options: EncodingOption,
    callback: (err: SystemError | null, folder: string) => void
  ): void;
  /**
   * Asynchronously creates a unique temporary directory.
   * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function mkdtemp(
    prefix: string,
    options:
      | "buffer"
      | {
          encoding: "buffer";
        },
    callback: (err: SystemError | null, folder: Buffer) => void
  ): void;
  /**
   * Asynchronously creates a unique temporary directory.
   * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function mkdtemp(
    prefix: string,
    options: EncodingOption,
    // tslint:disable-next-line:unified-signatures
    callback: (err: SystemError | null, folder: string | Buffer) => void
  ): void;
  /**
   * Asynchronously creates a unique temporary directory.
   * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
   */
  // tslint:disable-next-line:unified-signatures
  function mkdtemp(
    prefix: string,
    callback: (err: SystemError | null, folder: string) => void
  ): void;
  // namespace mkdtemp {
  //   /**
  //    * Asynchronously creates a unique temporary directory.
  //    * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     prefix: string,
  //     options?: EncodingOption
  //   ): Promise<string>;
  //   /**
  //    * Asynchronously creates a unique temporary directory.
  //    * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     prefix: string,
  //     options: BufferEncodingOption
  //   ): Promise<Buffer>;
  //   /**
  //    * Asynchronously creates a unique temporary directory.
  //    * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     prefix: string,
  //     options?: EncodingOption
  //   ): Promise<string | Buffer>;
  // }
  /**
   * Returns the created directory path.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link mkdtemp}.
   *
   * The optional `options` argument can be a string specifying an encoding, or an
   * object with an `encoding` property specifying the character encoding to use.
   * @since v0.0.67
   */
  function mkdtempSync(prefix: string, options?: EncodingOption): string;
  /**
   * Synchronously creates a unique temporary directory.
   * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function mkdtempSync(prefix: string, options: BufferEncodingOption): Buffer;
  /**
   * Synchronously creates a unique temporary directory.
   * Generates six random characters to be appended behind a required prefix to create a unique temporary directory.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function mkdtempSync(
    prefix: string,
    options?: EncodingOption
  ): string | Buffer;
  /**
   * Reads the contents of a directory. The callback gets two arguments `(err, files)`where `files` is an array of the names of the files in the directory excluding`'.'` and `'..'`.
   *
   * See the POSIX [`readdir(3)`](http://man7.org/linux/man-pages/man3/readdir.3.html) documentation for more details.
   *
   * The optional `options` argument can be a string specifying an encoding, or an
   * object with an `encoding` property specifying the character encoding to use for
   * the filenames passed to the callback. If the `encoding` is set to `'buffer'`,
   * the filenames returned will be passed as `Buffer` objects.
   *
   * If `options.withFileTypes` is set to `true`, the `files` array will contain `fs.Dirent` objects.
   * @since v0.0.67
   */
  function readdir(
    path: PathLike,
    options:
      | {
          encoding: BufferEncoding | null;
          withFileTypes?: false | undefined;
        }
      | BufferEncoding
      | undefined
      | null,
    callback: (err: SystemError | null, files: string[]) => void
  ): void;
  /**
   * Asynchronous readdir(3) - read a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function readdir(
    path: PathLike,
    options:
      | {
          encoding: "buffer";
          withFileTypes?: false | undefined;
        }
      | "buffer",
    callback: (err: SystemError | null, files: Buffer[]) => void
  ): void;
  /**
   * Asynchronous readdir(3) - read a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function readdir(
    path: PathLike,
    options:
      | (ObjectEncodingOptions & {
          withFileTypes?: false | undefined;
        })
      | BufferEncoding
      | undefined
      | null,
    callback: (err: SystemError | null, files: string[] | Buffer[]) => void
  ): void;
  /**
   * Asynchronous readdir(3) - read a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   */
  function readdir(
    path: PathLike,
    callback: (err: SystemError | null, files: string[]) => void
  ): void;
  /**
   * Asynchronous readdir(3) - read a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options If called with `withFileTypes: true` the result data will be an array of Dirent.
   */
  function readdir(
    path: PathLike,
    options: ObjectEncodingOptions & {
      withFileTypes: true;
    },
    callback: (err: SystemError | null, files: Dirent[]) => void
  ): void;
  // namespace readdir {
  //   /**
  //    * Asynchronous readdir(3) - read a directory.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?:
  //       | {
  //           encoding: BufferEncoding | null;
  //           withFileTypes?: false | undefined;
  //         }
  //       | BufferEncoding
  //       | null
  //   ): Promise<string[]>;
  //   /**
  //    * Asynchronous readdir(3) - read a directory.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options:
  //       | "buffer"
  //       | {
  //           encoding: "buffer";
  //           withFileTypes?: false | undefined;
  //         }
  //   ): Promise<Buffer[]>;
  //   /**
  //    * Asynchronous readdir(3) - read a directory.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options?:
  //       | (ObjectEncodingOptions & {
  //           withFileTypes?: false | undefined;
  //         })
  //       | BufferEncoding
  //       | null
  //   ): Promise<string[] | Buffer[]>;
  //   /**
  //    * Asynchronous readdir(3) - read a directory.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param options If called with `withFileTypes: true` the result data will be an array of Dirent
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     options: ObjectEncodingOptions & {
  //       withFileTypes: true;
  //     }
  //   ): Promise<Dirent[]>;
  // }
  /**
   * Reads the contents of the directory.
   *
   * See the POSIX [`readdir(3)`](http://man7.org/linux/man-pages/man3/readdir.3.html) documentation for more details.
   *
   * The optional `options` argument can be a string specifying an encoding, or an
   * object with an `encoding` property specifying the character encoding to use for
   * the filenames returned. If the `encoding` is set to `'buffer'`,
   * the filenames returned will be passed as `Buffer` objects.
   *
   * If `options.withFileTypes` is set to `true`, the result will contain `fs.Dirent` objects.
   * @since v0.0.67
   */
  function readdirSync(
    path: PathLike,
    options?:
      | {
          encoding: BufferEncoding | null;
          withFileTypes?: false | undefined;
        }
      | BufferEncoding
      | null
  ): string[];
  /**
   * Synchronous readdir(3) - read a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function readdirSync(
    path: PathLike,
    options:
      | {
          encoding: "buffer";
          withFileTypes?: false | undefined;
        }
      | "buffer"
  ): Buffer[];
  /**
   * Synchronous readdir(3) - read a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options The encoding (or an object specifying the encoding), used as the encoding of the result. If not provided, `'utf8'` is used.
   */
  function readdirSync(
    path: PathLike,
    options?:
      | (ObjectEncodingOptions & {
          withFileTypes?: false | undefined;
        })
      | BufferEncoding
      | null
  ): string[] | Buffer[];
  /**
   * Synchronous readdir(3) - read a directory.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * @param options If called with `withFileTypes: true` the result data will be an array of Dirent.
   */
  function readdirSync(
    path: PathLike,
    options: ObjectEncodingOptions & {
      withFileTypes: true;
    }
  ): Dirent[];
  /**
   * Closes the file descriptor. No arguments other than a possible exception are
   * given to the completion callback.
   *
   * Calling `fs.close()` on any file descriptor (`fd`) that is currently in use
   * through any other `fs` operation may lead to undefined behavior.
   *
   * See the POSIX [`close(2)`](http://man7.org/linux/man-pages/man2/close.2.html) documentation for more detail.
   * @since v0.0.67
   */
  function close(fd: number, callback?: NoParamCallback): void;
  // namespace close {
  //   /**
  //    * Asynchronous close(2) - close a file descriptor.
  //    * @param fd A file descriptor.
  //    */
  //   function __promisify__(fd: number): Promise<void>;
  // }
  /**
   * Closes the file descriptor. Returns `undefined`.
   *
   * Calling `fs.closeSync()` on any file descriptor (`fd`) that is currently in use
   * through any other `fs` operation may lead to undefined behavior.
   *
   * See the POSIX [`close(2)`](http://man7.org/linux/man-pages/man2/close.2.html) documentation for more detail.
   * @since v0.0.67
   */
  function closeSync(fd: number): void;
  /**
   * Asynchronous file open. See the POSIX [`open(2)`](http://man7.org/linux/man-pages/man2/open.2.html) documentation for more details.
   *
   * `mode` sets the file mode (permission and sticky bits), but only if the file was
   * created. On Windows, only the write permission can be manipulated; see {@link chmod}.
   *
   * The callback gets two arguments `(err, fd)`.
   *
   * Some characters (`< > : " / \ | ? *`) are reserved under Windows as documented
   * by [Naming Files, Paths, and Namespaces](https://docs.microsoft.com/en-us/windows/desktop/FileIO/naming-a-file). Under NTFS, if the filename contains
   * a colon, Node.js will open a file system stream, as described by [this MSDN page](https://docs.microsoft.com/en-us/windows/desktop/FileIO/using-streams).
   *
   * Functions based on `fs.open()` exhibit this behavior as well:`fs.writeFile()`, `fs.readFile()`, etc.
   * @since v0.0.67
   * @param [flags='r'] See `support of file system `flags``.
   * @param [mode=0o666]
   */
  function open(
    path: PathLike,
    flags: OpenMode,
    mode: Mode | undefined | null,
    callback: (err: SystemError | null, fd: number) => void
  ): void;
  /**
   * Asynchronous open(2) - open and possibly create a file. If the file is created, its mode will be `0o666`.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   */
  function open(
    path: PathLike,
    flags: OpenMode,
    callback: (err: SystemError | null, fd: number) => void
  ): void;
  // namespace open {
  //   /**
  //    * Asynchronous open(2) - open and possibly create a file.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param mode A file mode. If a string is passed, it is parsed as an octal integer. If not supplied, defaults to `0o666`.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     flags: OpenMode,
  //     mode?: Mode | null
  //   ): Promise<number>;
  // }
  /**
   * Returns an integer representing the file descriptor.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link open}.
   * @since v0.0.67
   * @param [flags='r']
   * @param [mode=0o666]
   */
  function openSync(
    path: PathLike,
    flags: OpenMode,
    mode?: Mode | null
  ): number;
  /**
   * Change the file system timestamps of the object referenced by `path`.
   *
   * The `atime` and `mtime` arguments follow these rules:
   *
   * * Values can be either numbers representing Unix epoch time in seconds,`Date`s, or a numeric string like `'123456789.0'`.
   * * If the value can not be converted to a number, or is `NaN`, `Infinity` or`-Infinity`, an `Error` will be thrown.
   * @since v0.0.67
   */
  function utimes(
    path: PathLike,
    atime: TimeLike,
    mtime: TimeLike,
    callback: NoParamCallback
  ): void;
  // namespace utimes {
  //   /**
  //    * Asynchronously change file timestamps of the file referenced by the supplied path.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * @param atime The last access time. If a string is provided, it will be coerced to number.
  //    * @param mtime The last modified time. If a string is provided, it will be coerced to number.
  //    */
  //   function __promisify__(
  //     path: PathLike,
  //     atime: TimeLike,
  //     mtime: TimeLike
  //   ): Promise<void>;
  // }
  /**
   * Returns `undefined`.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link utimes}.
   * @since v0.0.67
   */
  function utimesSync(path: PathLike, atime: TimeLike, mtime: TimeLike): void;
  /**
   * Change the file system timestamps of the object referenced by the supplied file
   * descriptor. See {@link utimes}.
   * @since v0.0.67
   */
  function futimes(
    fd: number,
    atime: TimeLike,
    mtime: TimeLike,
    callback: NoParamCallback
  ): void;
  // namespace futimes {
  //   /**
  //    * Asynchronously change file timestamps of the file referenced by the supplied file descriptor.
  //    * @param fd A file descriptor.
  //    * @param atime The last access time. If a string is provided, it will be coerced to number.
  //    * @param mtime The last modified time. If a string is provided, it will be coerced to number.
  //    */
  //   function __promisify__(
  //     fd: number,
  //     atime: TimeLike,
  //     mtime: TimeLike
  //   ): Promise<void>;
  // }
  /**
   * Synchronous version of {@link futimes}. Returns `undefined`.
   * @since v0.0.67
   */
  function futimesSync(fd: number, atime: TimeLike, mtime: TimeLike): void;
  /**
   * Request that all data for the open file descriptor is flushed to the storage
   * device. The specific implementation is operating system and device specific.
   * Refer to the POSIX [`fsync(2)`](http://man7.org/linux/man-pages/man2/fsync.2.html) documentation for more detail. No arguments other
   * than a possible exception are given to the completion callback.
   * @since v0.0.67
   */
  function fsync(fd: number, callback: NoParamCallback): void;
  // namespace fsync {
  //   /**
  //    * Asynchronous fsync(2) - synchronize a file's in-core state with the underlying storage device.
  //    * @param fd A file descriptor.
  //    */
  //   function __promisify__(fd: number): Promise<void>;
  // }
  /**
   * Request that all data for the open file descriptor is flushed to the storage
   * device. The specific implementation is operating system and device specific.
   * Refer to the POSIX [`fsync(2)`](http://man7.org/linux/man-pages/man2/fsync.2.html) documentation for more detail. Returns `undefined`.
   * @since v0.0.67
   */
  function fsyncSync(fd: number): void;
  /**
   * Write `buffer` to the file specified by `fd`. If `buffer` is a normal object, it
   * must have an own `toString` function property.
   *
   * `offset` determines the part of the buffer to be written, and `length` is
   * an integer specifying the number of bytes to write.
   *
   * `position` refers to the offset from the beginning of the file where this data
   * should be written. If `typeof position !== 'number'`, the data will be written
   * at the current position. See [`pwrite(2)`](http://man7.org/linux/man-pages/man2/pwrite.2.html).
   *
   * The callback will be given three arguments `(err, bytesWritten, buffer)` where`bytesWritten` specifies how many _bytes_ were written from `buffer`.
   *
   * If this method is invoked as its `util.promisify()` ed version, it returns
   * a promise for an `Object` with `bytesWritten` and `buffer` properties.
   *
   * It is unsafe to use `fs.write()` multiple times on the same file without waiting
   * for the callback.
   *
   * On Linux, positional writes don't work when the file is opened in append mode.
   * The kernel ignores the position argument and always appends the data to
   * the end of the file.
   * @since v0.0.67
   */
  function write<TBuffer extends ArrayBufferView>(
    fd: number,
    buffer: TBuffer,
    offset: number | undefined | null,
    length: number | undefined | null,
    position: number | undefined | null,
    callback: (
      err: SystemError | null,
      written: number,
      buffer: TBuffer
    ) => void
  ): void;
  /**
   * Asynchronously writes `buffer` to the file referenced by the supplied file descriptor.
   * @param fd A file descriptor.
   * @param offset The part of the buffer to be written. If not supplied, defaults to `0`.
   * @param length The number of bytes to write. If not supplied, defaults to `buffer.length - offset`.
   */
  function write<TBuffer extends ArrayBufferView>(
    fd: number,
    buffer: TBuffer,
    offset: number | undefined | null,
    length: number | undefined | null,
    callback: (
      err: SystemError | null,
      written: number,
      buffer: TBuffer
    ) => void
  ): void;
  /**
   * Asynchronously writes `buffer` to the file referenced by the supplied file descriptor.
   * @param fd A file descriptor.
   * @param offset The part of the buffer to be written. If not supplied, defaults to `0`.
   */
  function write<TBuffer extends ArrayBufferView>(
    fd: number,
    buffer: TBuffer,
    offset: number | undefined | null,
    callback: (
      err: SystemError | null,
      written: number,
      buffer: TBuffer
    ) => void
  ): void;
  /**
   * Asynchronously writes `buffer` to the file referenced by the supplied file descriptor.
   * @param fd A file descriptor.
   */
  function write<TBuffer extends ArrayBufferView>(
    fd: number,
    buffer: TBuffer,
    callback: (
      err: SystemError | null,
      written: number,
      buffer: TBuffer
    ) => void
  ): void;
  /**
   * Asynchronously writes `string` to the file referenced by the supplied file descriptor.
   * @param fd A file descriptor.
   * @param string A string to write.
   * @param position The offset from the beginning of the file where this data should be written. If not supplied, defaults to the current position.
   * @param encoding The expected string encoding.
   */
  function write(
    fd: number,
    string: string,
    position: number | undefined | null,
    encoding: BufferEncoding | undefined | null,
    callback: (err: SystemError | null, written: number, str: string) => void
  ): void;
  /**
   * Asynchronously writes `string` to the file referenced by the supplied file descriptor.
   * @param fd A file descriptor.
   * @param string A string to write.
   * @param position The offset from the beginning of the file where this data should be written. If not supplied, defaults to the current position.
   */
  function write(
    fd: number,
    string: string,
    position: number | undefined | null,
    callback: (err: SystemError | null, written: number, str: string) => void
  ): void;
  /**
   * Asynchronously writes `string` to the file referenced by the supplied file descriptor.
   * @param fd A file descriptor.
   * @param string A string to write.
   */
  function write(
    fd: number,
    string: string,
    callback: (err: SystemError | null, written: number, str: string) => void
  ): void;
  // namespace write {
  //   /**
  //    * Asynchronously writes `buffer` to the file referenced by the supplied file descriptor.
  //    * @param fd A file descriptor.
  //    * @param offset The part of the buffer to be written. If not supplied, defaults to `0`.
  //    * @param length The number of bytes to write. If not supplied, defaults to `buffer.length - offset`.
  //    * @param position The offset from the beginning of the file where this data should be written. If not supplied, defaults to the current position.
  //    */
  //   function __promisify__<TBuffer extends ArrayBufferView>(
  //     fd: number,
  //     buffer?: TBuffer,
  //     offset?: number,
  //     length?: number,
  //     position?: number | null
  //   ): Promise<{
  //     bytesWritten: number;
  //     buffer: TBuffer;
  //   }>;
  //   /**
  //    * Asynchronously writes `string` to the file referenced by the supplied file descriptor.
  //    * @param fd A file descriptor.
  //    * @param string A string to write.
  //    * @param position The offset from the beginning of the file where this data should be written. If not supplied, defaults to the current position.
  //    * @param encoding The expected string encoding.
  //    */
  //   function __promisify__(
  //     fd: number,
  //     string: string,
  //     position?: number | null,
  //     encoding?: BufferEncoding | null
  //   ): Promise<{
  //     bytesWritten: number;
  //     buffer: string;
  //   }>;
  // }
  /**
   * If `buffer` is a plain object, it must have an own (not inherited) `toString`function property.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link write}.
   * @since v0.0.67
   * @return The number of bytes written.
   */
  function writeSync(
    fd: number,
    buffer: ArrayBufferView,
    offset?: number | null,
    length?: number | null,
    position?: number | null
  ): number;
  /**
   * Synchronously writes `string` to the file referenced by the supplied file descriptor, returning the number of bytes written.
   * @param fd A file descriptor.
   * @param string A string to write.
   * @param position The offset from the beginning of the file where this data should be written. If not supplied, defaults to the current position.
   * @param encoding The expected string encoding.
   */
  function writeSync(
    fd: number,
    string: string,
    position?: number | null,
    encoding?: BufferEncoding | null
  ): number;
  type ReadPosition = number | bigint;
  interface ReadSyncOptions {
    /**
     * @default 0
     */
    offset?: number | undefined;
    /**
     * @default `length of buffer`
     */
    length?: number | undefined;
    /**
     * @default null
     */
    position?: ReadPosition | null | undefined;
  }
  interface ReadAsyncOptions<TBuffer extends ArrayBufferView>
    extends ReadSyncOptions {
    buffer?: TBuffer;
  }
  /**
   * Read data from the file specified by `fd`.
   *
   * The callback is given the three arguments, `(err, bytesRead, buffer)`.
   *
   * If the file is not modified concurrently, the end-of-file is reached when the
   * number of bytes read is zero.
   *
   * If this method is invoked as its `util.promisify()` ed version, it returns
   * a promise for an `Object` with `bytesRead` and `buffer` properties.
   * @since v0.0.67
   * @param buffer The buffer that the data will be written to.
   * @param offset The position in `buffer` to write the data to.
   * @param length The number of bytes to read.
   * @param position Specifies where to begin reading from in the file. If `position` is `null` or `-1 `, data will be read from the current file position, and the file position will be updated. If
   * `position` is an integer, the file position will be unchanged.
   */
  function read<TBuffer extends ArrayBufferView>(
    fd: number,
    buffer: TBuffer,
    offset: number,
    length: number,
    position: ReadPosition | null,
    callback: (
      err: SystemError | null,
      bytesRead: number,
      buffer: TBuffer
    ) => void
  ): void;
  /**
   * Similar to the above `fs.read` function, this version takes an optional `options` object.
   * If not otherwise specified in an `options` object,
   * `buffer` defaults to `Buffer.alloc(16384)`,
   * `offset` defaults to `0`,
   * `length` defaults to `buffer.byteLength`, `- offset` as of Node 17.6.0
   * `position` defaults to `null`
   * @since v0.0.67
   */
  function read<TBuffer extends ArrayBufferView>(
    fd: number,
    options: ReadAsyncOptions<TBuffer>,
    callback: (
      err: SystemError | null,
      bytesRead: number,
      buffer: TBuffer
    ) => void
  ): void;
  function read(
    fd: number,
    callback: (
      err: SystemError | null,
      bytesRead: number,
      buffer: ArrayBufferView
    ) => void
  ): void;
  // namespace read {
  //   /**
  //    * @param fd A file descriptor.
  //    * @param buffer The buffer that the data will be written to.
  //    * @param offset The offset in the buffer at which to start writing.
  //    * @param length The number of bytes to read.
  //    * @param position The offset from the beginning of the file from which data should be read. If `null`, data will be read from the current position.
  //    */
  //   function __promisify__<TBuffer extends ArrayBufferView>(
  //     fd: number,
  //     buffer: TBuffer,
  //     offset: number,
  //     length: number,
  //     position: number | null
  //   ): Promise<{
  //     bytesRead: number;
  //     buffer: TBuffer;
  //   }>;
  //   function __promisify__<TBuffer extends ArrayBufferView>(
  //     fd: number,
  //     options: ReadAsyncOptions<TBuffer>
  //   ): Promise<{
  //     bytesRead: number;
  //     buffer: TBuffer;
  //   }>;
  //   function __promisify__(fd: number): Promise<{
  //     bytesRead: number;
  //     buffer: ArrayBufferView;
  //   }>;
  // }

  // TODO: Add AbortSignal support
  // tslint:disable-next-line:no-empty-interface
  interface Abortable {}

  /**
   * Returns the number of `bytesRead`.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link read}.
   * @since v0.0.67
   */
  function readSync(
    fd: number,
    buffer: ArrayBufferView,
    offset: number,
    length: number,
    position: ReadPosition | null
  ): number;
  /**
   * Similar to the above `fs.readSync` function, this version takes an optional `options` object.
   * If no `options` object is specified, it will default with the above values.
   */
  function readSync(
    fd: number,
    buffer: ArrayBufferView,
    opts?: ReadSyncOptions
  ): number;
  /**
   * Asynchronously reads the entire contents of a file.
   *
   * ```js
   * import { readFile } from 'fs';
   *
   * readFile('/etc/passwd', (err, data) => {
   *   if (err) throw err;
   *   console.log(data);
   * });
   * ```
   *
   * The callback is passed two arguments `(err, data)`, where `data` is the
   * contents of the file.
   *
   * If no encoding is specified, then the raw buffer is returned.
   *
   * If `options` is a string, then it specifies the encoding:
   *
   * ```js
   * import { readFile } from 'fs';
   *
   * readFile('/etc/passwd', 'utf8', callback);
   * ```
   *
   * When the path is a directory, the behavior of `fs.readFile()` and {@link readFileSync} is platform-specific. On macOS, Linux, and Windows, an
   * error will be returned. On FreeBSD, a representation of the directory's contents
   * will be returned.
   *
   * ```js
   * import { readFile } from 'fs';
   *
   * // macOS, Linux, and Windows
   * readFile('<directory>', (err, data) => {
   *   // => [Error: EISDIR: illegal operation on a directory, read <directory>]
   * });
   *
   * //  FreeBSD
   * readFile('<directory>', (err, data) => {
   *   // => null, <data>
   * });
   * ```
   *
   * It is possible to abort an ongoing request using an `AbortSignal`. If a
   * request is aborted the callback is called with an `AbortError`:
   *
   * ```js
   * import { readFile } from 'fs';
   *
   * const controller = new AbortController();
   * const signal = controller.signal;
   * readFile(fileInfo[0].name, { signal }, (err, buf) => {
   *   // ...
   * });
   * // When you want to abort the request
   * controller.abort();
   * ```
   *
   * The `fs.readFile()` function buffers the entire file. To minimize memory costs,
   * when possible prefer streaming via `fs.createReadStream()`.
   *
   * Aborting an ongoing request does not abort individual operating
   * system requests but rather the internal buffering `fs.readFile` performs.
   * @since v0.0.67
   * @param path filename or file descriptor
   */
  function readFile(
    path: PathOrFileDescriptor,
    options:
      | ({
          encoding?: null | undefined;
          flag?: string | undefined;
        } & Abortable)
      | undefined
      | null,
    callback: (err: SystemError | null, data: Buffer) => void
  ): void;
  /**
   * Asynchronously reads the entire contents of a file.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
   * @param options Either the encoding for the result, or an object that contains the encoding and an optional flag.
   * If a flag is not provided, it defaults to `'r'`.
   */
  function readFile(
    path: PathOrFileDescriptor,
    options:
      | ({
          encoding: BufferEncoding;
          flag?: string | undefined;
        } & Abortable)
      | BufferEncoding,
    callback: (err: SystemError | null, data: string) => void
  ): void;
  /**
   * Asynchronously reads the entire contents of a file.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
   * @param options Either the encoding for the result, or an object that contains the encoding and an optional flag.
   * If a flag is not provided, it defaults to `'r'`.
   */
  function readFile(
    path: PathOrFileDescriptor,
    options:
      | (ObjectEncodingOptions & {
          flag?: string | undefined;
        } & Abortable)
      | BufferEncoding
      | undefined
      | null,
    callback: (err: SystemError | null, data: string | Buffer) => void
  ): void;
  /**
   * Asynchronously reads the entire contents of a file.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
   */
  function readFile(
    path: PathOrFileDescriptor,
    callback: (err: SystemError | null, data: Buffer) => void
  ): void;
  // namespace readFile {
  //   /**
  //    * Asynchronously reads the entire contents of a file.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
  //    * @param options An object that may contain an optional flag.
  //    * If a flag is not provided, it defaults to `'r'`.
  //    */
  //   function __promisify__(
  //     path: PathOrFileDescriptor,
  //     options?: {
  //       encoding?: null | undefined;
  //       flag?: string | undefined;
  //     } | null
  //   ): Promise<Buffer>;
  //   /**
  //    * Asynchronously reads the entire contents of a file.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * URL support is _experimental_.
  //    * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
  //    * @param options Either the encoding for the result, or an object that contains the encoding and an optional flag.
  //    * If a flag is not provided, it defaults to `'r'`.
  //    */
  //   function __promisify__(
  //     path: PathOrFileDescriptor,
  //     options:
  //       | {
  //           encoding: BufferEncoding;
  //           flag?: string | undefined;
  //         }
  //       | BufferEncoding
  //   ): Promise<string>;
  //   /**
  //    * Asynchronously reads the entire contents of a file.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * URL support is _experimental_.
  //    * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
  //    * @param options Either the encoding for the result, or an object that contains the encoding and an optional flag.
  //    * If a flag is not provided, it defaults to `'r'`.
  //    */
  //   function __promisify__(
  //     path: PathOrFileDescriptor,
  //     options?:
  //       | (ObjectEncodingOptions & {
  //           flag?: string | undefined;
  //         })
  //       | BufferEncoding
  //       | null
  //   ): Promise<string | Buffer>;
  // }
  /**
   * Returns the contents of the `path`.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link readFile}.
   *
   * If the `encoding` option is specified then this function returns a
   * string. Otherwise it returns a buffer.
   *
   * Similar to {@link readFile}, when the path is a directory, the behavior of`fs.readFileSync()` is platform-specific.
   *
   * ```js
   * import { readFileSync } from 'fs';
   *
   * // macOS, Linux, and Windows
   * readFileSync('<directory>');
   * // => [Error: EISDIR: illegal operation on a directory, read <directory>]
   *
   * //  FreeBSD
   * readFileSync('<directory>'); // => <data>
   * ```
   * @since v0.0.67
   * @param path filename or file descriptor
   */
  function readFileSync(
    path: PathOrFileDescriptor,
    options?: {
      encoding?: null | undefined;
      flag?: string | undefined;
    } | null
  ): Buffer;
  /**
   * Synchronously reads the entire contents of a file.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
   * @param options Either the encoding for the result, or an object that contains the encoding and an optional flag.
   * If a flag is not provided, it defaults to `'r'`.
   */
  function readFileSync(
    path: PathOrFileDescriptor,
    options:
      | {
          encoding: BufferEncoding;
          flag?: string | undefined;
        }
      | BufferEncoding
  ): string;
  /**
   * Synchronously reads the entire contents of a file.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
   * @param options Either the encoding for the result, or an object that contains the encoding and an optional flag.
   * If a flag is not provided, it defaults to `'r'`.
   */
  function readFileSync(
    path: PathOrFileDescriptor,
    options?:
      | (ObjectEncodingOptions & {
          flag?: string | undefined;
        })
      | BufferEncoding
      | null
  ): string | Buffer;
  type WriteFileOptions =
    | (ObjectEncodingOptions &
        Abortable & {
          mode?: Mode | undefined;
          flag?: string | undefined;
        })
    | BufferEncoding
    | null;
  /**
   * When `file` is a filename, asynchronously writes data to the file, replacing the
   * file if it already exists. `data` can be a string or a buffer.
   *
   * When `file` is a file descriptor, the behavior is similar to calling`fs.write()` directly (which is recommended). See the notes below on using
   * a file descriptor.
   *
   * The `encoding` option is ignored if `data` is a buffer.
   *
   * The `mode` option only affects the newly created file. See {@link open} for more details.
   *
   * If `data` is a plain object, it must have an own (not inherited) `toString`function property.
   *
   * ```js
   * import { writeFile } from 'fs';
   * import { Buffer } from 'buffer';
   *
   * const data = new Uint8Array(Buffer.from('Hello Node.js'));
   * writeFile('message.txt', data, (err) => {
   *   if (err) throw err;
   *   console.log('The file has been saved!');
   * });
   * ```
   *
   * If `options` is a string, then it specifies the encoding:
   *
   * ```js
   * import { writeFile } from 'fs';
   *
   * writeFile('message.txt', 'Hello Node.js', 'utf8', callback);
   * ```
   *
   * It is unsafe to use `fs.writeFile()` multiple times on the same file without
   * waiting for the callback.
   *
   * Similarly to `fs.readFile` \- `fs.writeFile` is a convenience method that
   * performs multiple `write` calls internally to write the buffer passed to it.
   *
   * It is possible to use an `AbortSignal` to cancel an `fs.writeFile()`.
   * Cancelation is "best effort", and some amount of data is likely still
   * to be written.
   *
   * ```js
   * import { writeFile } from 'fs';
   * import { Buffer } from 'buffer';
   *
   * const controller = new AbortController();
   * const { signal } = controller;
   * const data = new Uint8Array(Buffer.from('Hello Node.js'));
   * writeFile('message.txt', data, { signal }, (err) => {
   *   // When a request is aborted - the callback is called with an AbortError
   * });
   * // When the request should be aborted
   * controller.abort();
   * ```
   *
   * Aborting an ongoing request does not abort individual operating
   * system requests but rather the internal buffering `fs.writeFile` performs.
   * @since v0.0.67
   * @param file filename or file descriptor
   */
  function writeFile(
    file: PathOrFileDescriptor,
    data: string | ArrayBufferView,
    options: WriteFileOptions,
    callback: NoParamCallback
  ): void;
  /**
   * Asynchronously writes data to a file, replacing the file if it already exists.
   * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
   * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
   * @param data The data to write. If something other than a Buffer or Uint8Array is provided, the value is coerced to a string.
   */
  function writeFile(
    path: PathOrFileDescriptor,
    data: string | ArrayBufferView,
    callback: NoParamCallback
  ): void;
  // namespace writeFile {
  //   /**
  //    * Asynchronously writes data to a file, replacing the file if it already exists.
  //    * @param path A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * URL support is _experimental_.
  //    * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
  //    * @param data The data to write. If something other than a Buffer or Uint8Array is provided, the value is coerced to a string.
  //    * @param options Either the encoding for the file, or an object optionally specifying the encoding, file mode, and flag.
  //    * If `encoding` is not supplied, the default of `'utf8'` is used.
  //    * If `mode` is not supplied, the default of `0o666` is used.
  //    * If `mode` is a string, it is parsed as an octal integer.
  //    * If `flag` is not supplied, the default of `'w'` is used.
  //    */
  //   function __promisify__(
  //     path: PathOrFileDescriptor,
  //     data: string | ArrayBufferView,
  //     options?: WriteFileOptions
  //   ): Promise<void>;
  // }
  /**
   * Returns `undefined`.
   *
   * If `data` is a plain object, it must have an own (not inherited) `toString`function property.
   *
   * The `mode` option only affects the newly created file. See {@link open} for more details.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link writeFile}.
   * @since v0.0.67
   * @param file filename or file descriptor
   */
  function writeFileSync(
    file: PathOrFileDescriptor,
    data: string | ArrayBufferView,
    options?: WriteFileOptions
  ): void;
  /**
   * Asynchronously append data to a file, creating the file if it does not yet
   * exist. `data` can be a string or a `Buffer`.
   *
   * The `mode` option only affects the newly created file. See {@link open} for more details.
   *
   * ```js
   * import { appendFile } from 'fs';
   *
   * appendFile('message.txt', 'data to append', (err) => {
   *   if (err) throw err;
   *   console.log('The "data to append" was appended to file!');
   * });
   * ```
   *
   * If `options` is a string, then it specifies the encoding:
   *
   * ```js
   * import { appendFile } from 'fs';
   *
   * appendFile('message.txt', 'data to append', 'utf8', callback);
   * ```
   *
   * The `path` may be specified as a numeric file descriptor that has been opened
   * for appending (using `fs.open()` or `fs.openSync()`). The file descriptor will
   * not be closed automatically.
   *
   * ```js
   * import { open, close, appendFile } from 'fs';
   *
   * function closeFd(fd) {
   *   close(fd, (err) => {
   *     if (err) throw err;
   *   });
   * }
   *
   * open('message.txt', 'a', (err, fd) => {
   *   if (err) throw err;
   *
   *   try {
   *     appendFile(fd, 'data to append', 'utf8', (err) => {
   *       closeFd(fd);
   *       if (err) throw err;
   *     });
   *   } catch (err) {
   *     closeFd(fd);
   *     throw err;
   *   }
   * });
   * ```
   * @since v0.0.67
   * @param path filename or file descriptor
   */
  function appendFile(
    path: PathOrFileDescriptor,
    data: string | Uint8Array,
    options: WriteFileOptions,
    callback: NoParamCallback
  ): void;
  /**
   * Asynchronously append data to a file, creating the file if it does not exist.
   * @param file A path to a file. If a URL is provided, it must use the `file:` protocol.
   * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
   * @param data The data to write. If something other than a Buffer or Uint8Array is provided, the value is coerced to a string.
   */
  function appendFile(
    file: PathOrFileDescriptor,
    data: string | Uint8Array,
    callback: NoParamCallback
  ): void;
  // namespace appendFile {
  //   /**
  //    * Asynchronously append data to a file, creating the file if it does not exist.
  //    * @param file A path to a file. If a URL is provided, it must use the `file:` protocol.
  //    * URL support is _experimental_.
  //    * If a file descriptor is provided, the underlying file will _not_ be closed automatically.
  //    * @param data The data to write. If something other than a Buffer or Uint8Array is provided, the value is coerced to a string.
  //    * @param options Either the encoding for the file, or an object optionally specifying the encoding, file mode, and flag.
  //    * If `encoding` is not supplied, the default of `'utf8'` is used.
  //    * If `mode` is not supplied, the default of `0o666` is used.
  //    * If `mode` is a string, it is parsed as an octal integer.
  //    * If `flag` is not supplied, the default of `'a'` is used.
  //    */
  //   function __promisify__(
  //     file: PathOrFileDescriptor,
  //     data: string | Uint8Array,
  //     options?: WriteFileOptions
  //   ): Promise<void>;
  // }
  /**
   * Synchronously append data to a file, creating the file if it does not yet
   * exist. `data` can be a string or a `Buffer`.
   *
   * The `mode` option only affects the newly created file. See {@link open} for more details.
   *
   * ```js
   * import { appendFileSync } from 'fs';
   *
   * try {
   *   appendFileSync('message.txt', 'data to append');
   *   console.log('The "data to append" was appended to file!');
   * } catch (err) {
   *   // Handle the error
   * }
   * ```
   *
   * If `options` is a string, then it specifies the encoding:
   *
   * ```js
   * import { appendFileSync } from 'fs';
   *
   * appendFileSync('message.txt', 'data to append', 'utf8');
   * ```
   *
   * The `path` may be specified as a numeric file descriptor that has been opened
   * for appending (using `fs.open()` or `fs.openSync()`). The file descriptor will
   * not be closed automatically.
   *
   * ```js
   * import { openSync, closeSync, appendFileSync } from 'fs';
   *
   * let fd;
   *
   * try {
   *   fd = openSync('message.txt', 'a');
   *   appendFileSync(fd, 'data to append', 'utf8');
   * } catch (err) {
   *   // Handle the error
   * } finally {
   *   if (fd !== undefined)
   *     closeSync(fd);
   * }
   * ```
   * @since v0.0.67
   * @param path filename or file descriptor
   */
  function appendFileSync(
    path: PathOrFileDescriptor,
    data: string | Uint8Array,
    options?: WriteFileOptions
  ): void;

  /**
   * Test whether or not the given path exists by checking with the file system.
   * Then call the `callback` argument with either true or false:
   *
   * ```js
   * import { exists } from 'fs';
   *
   * exists('/etc/passwd', (e) => {
   *   console.log(e ? 'it exists' : 'no passwd!');
   * });
   * ```
   *
   * **The parameters for this callback are not consistent with other Node.js**
   * **callbacks.** Normally, the first parameter to a Node.js callback is an `err`parameter, optionally followed by other parameters. The `fs.exists()` callback
   * has only one boolean parameter. This is one reason `fs.access()` is recommended
   * instead of `fs.exists()`.
   *
   * Using `fs.exists()` to check for the existence of a file before calling`fs.open()`, `fs.readFile()` or `fs.writeFile()` is not recommended. Doing
   * so introduces a race condition, since other processes may change the file's
   * state between the two calls. Instead, user code should open/read/write the
   * file directly and handle the error raised if the file does not exist.
   *
   * **write (NOT RECOMMENDED)**
   *
   * ```js
   * import { exists, open, close } from 'fs';
   *
   * exists('myfile', (e) => {
   *   if (e) {
   *     console.error('myfile already exists');
   *   } else {
   *     open('myfile', 'wx', (err, fd) => {
   *       if (err) throw err;
   *
   *       try {
   *         writeMyData(fd);
   *       } finally {
   *         close(fd, (err) => {
   *           if (err) throw err;
   *         });
   *       }
   *     });
   *   }
   * });
   * ```
   *
   * **write (RECOMMENDED)**
   *
   * ```js
   * import { open, close } from 'fs';
   * open('myfile', 'wx', (err, fd) => {
   *   if (err) {
   *     if (err.code === 'EEXIST') {
   *       console.error('myfile already exists');
   *       return;
   *     }
   *
   *     throw err;
   *   }
   *
   *   try {
   *     writeMyData(fd);
   *   } finally {
   *     close(fd, (err) => {
   *       if (err) throw err;
   *     });
   *   }
   * });
   * ```
   *
   * **read (NOT RECOMMENDED)**
   *
   * ```js
   * import { open, close, exists } from 'fs';
   *
   * exists('myfile', (e) => {
   *   if (e) {
   *     open('myfile', 'r', (err, fd) => {
   *       if (err) throw err;
   *
   *       try {
   *         readMyData(fd);
   *       } finally {
   *         close(fd, (err) => {
   *           if (err) throw err;
   *         });
   *       }
   *     });
   *   } else {
   *     console.error('myfile does not exist');
   *   }
   * });
   * ```
   *
   * **read (RECOMMENDED)**
   *
   * ```js
   * import { open, close } from 'fs';
   *
   * open('myfile', 'r', (err, fd) => {
   *   if (err) {
   *     if (err.code === 'ENOENT') {
   *       console.error('myfile does not exist');
   *       return;
   *     }
   *
   *     throw err;
   *   }
   *
   *   try {
   *     readMyData(fd);
   *   } finally {
   *     close(fd, (err) => {
   *       if (err) throw err;
   *     });
   *   }
   * });
   * ```
   *
   * The "not recommended" examples above check for existence and then use the
   * file; the "recommended" examples are better because they use the file directly
   * and handle the error, if any.
   *
   * In general, check for the existence of a file only if the file won’t be
   * used directly, for example when its existence is a signal from another
   * process.
   * @since v0.0.67
   */
  function exists(path: PathLike, callback: (exists: boolean) => void): void;
  /**
   * Returns `true` if the path exists, `false` otherwise.
   *
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link exists}.
   *
   * `fs.exists()` is deprecated, but `fs.existsSync()` is not. The `callback`parameter to `fs.exists()` accepts parameters that are inconsistent with other
   * Node.js callbacks. `fs.existsSync()` does not use a callback.
   *
   * ```js
   * import { existsSync } from 'fs';
   *
   * if (existsSync('/etc/passwd'))
   *   console.log('The path exists.');
   * ```
   * @since v0.0.67
   */
  function existsSync(path: PathLike): boolean;
  namespace constants {
    // File Access Constants
    /** Constant for fs.access(). File is visible to the calling process. */
    var F_OK: number;
    /** Constant for fs.access(). File can be read by the calling process. */
    var R_OK: number;
    /** Constant for fs.access(). File can be written by the calling process. */
    var W_OK: number;
    /** Constant for fs.access(). File can be executed by the calling process. */
    var X_OK: number;
    // File Copy Constants
    /** Constant for fs.copyFile. Flag indicating the destination file should not be overwritten if it already exists. */
    var COPYFILE_EXCL: number;
    /**
     * Constant for fs.copyFile. copy operation will attempt to create a copy-on-write reflink.
     * If the underlying platform does not support copy-on-write, then a fallback copy mechanism is used.
     */
    var COPYFILE_FICLONE: number;
    /**
     * Constant for fs.copyFile. Copy operation will attempt to create a copy-on-write reflink.
     * If the underlying platform does not support copy-on-write, then the operation will fail with an error.
     */
    var COPYFILE_FICLONE_FORCE: number;
    // File Open Constants
    /** Constant for fs.open(). Flag indicating to open a file for read-only access. */
    var O_RDONLY: number;
    /** Constant for fs.open(). Flag indicating to open a file for write-only access. */
    var O_WRONLY: number;
    /** Constant for fs.open(). Flag indicating to open a file for read-write access. */
    var O_RDWR: number;
    /** Constant for fs.open(). Flag indicating to create the file if it does not already exist. */
    var O_CREAT: number;
    /** Constant for fs.open(). Flag indicating that opening a file should fail if the O_CREAT flag is set and the file already exists. */
    var O_EXCL: number;
    /**
     * Constant for fs.open(). Flag indicating that if path identifies a terminal device,
     * opening the path shall not cause that terminal to become the controlling terminal for the process
     * (if the process does not already have one).
     */
    var O_NOCTTY: number;
    /** Constant for fs.open(). Flag indicating that if the file exists and is a regular file, and the file is opened successfully for write access, its length shall be truncated to zero. */
    var O_TRUNC: number;
    /** Constant for fs.open(). Flag indicating that data will be appended to the end of the file. */
    var O_APPEND: number;
    /** Constant for fs.open(). Flag indicating that the open should fail if the path is not a directory. */
    var O_DIRECTORY: number;
    /**
     * constant for fs.open().
     * Flag indicating reading accesses to the file system will no longer result in
     * an update to the atime information associated with the file.
     * This flag is available on Linux operating systems only.
     */
    var O_NOATIME: number;
    /** Constant for fs.open(). Flag indicating that the open should fail if the path is a symbolic link. */
    var O_NOFOLLOW: number;
    /** Constant for fs.open(). Flag indicating that the file is opened for synchronous I/O. */
    var O_SYNC: number;
    /** Constant for fs.open(). Flag indicating that the file is opened for synchronous I/O with write operations waiting for data integrity. */
    var O_DSYNC: number;
    /** Constant for fs.open(). Flag indicating to open the symbolic link itself rather than the resource it is pointing to. */
    var O_SYMLINK: number;
    /** Constant for fs.open(). When set, an attempt will be made to minimize caching effects of file I/O. */
    var O_DIRECT: number;
    /** Constant for fs.open(). Flag indicating to open the file in nonblocking mode when possible. */
    var O_NONBLOCK: number;
    // File Type Constants
    /** Constant for fs.Stats mode property for determining a file's type. Bit mask used to extract the file type code. */
    var S_IFMT: number;
    /** Constant for fs.Stats mode property for determining a file's type. File type constant for a regular file. */
    var S_IFREG: number;
    /** Constant for fs.Stats mode property for determining a file's type. File type constant for a directory. */
    var S_IFDIR: number;
    /** Constant for fs.Stats mode property for determining a file's type. File type constant for a character-oriented device file. */
    var S_IFCHR: number;
    /** Constant for fs.Stats mode property for determining a file's type. File type constant for a block-oriented device file. */
    var S_IFBLK: number;
    /** Constant for fs.Stats mode property for determining a file's type. File type constant for a FIFO/pipe. */
    var S_IFIFO: number;
    /** Constant for fs.Stats mode property for determining a file's type. File type constant for a symbolic link. */
    var S_IFLNK: number;
    /** Constant for fs.Stats mode property for determining a file's type. File type constant for a socket. */
    var S_IFSOCK: number;
    // File Mode Constants
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable, writable and executable by owner. */
    var S_IRWXU: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable by owner. */
    var S_IRUSR: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating writable by owner. */
    var S_IWUSR: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by owner. */
    var S_IXUSR: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable, writable and executable by group. */
    var S_IRWXG: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable by group. */
    var S_IRGRP: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating writable by group. */
    var S_IWGRP: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by group. */
    var S_IXGRP: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable, writable and executable by others. */
    var S_IRWXO: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating readable by others. */
    var S_IROTH: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating writable by others. */
    var S_IWOTH: number;
    /** Constant for fs.Stats mode property for determining access permissions for a file. File mode indicating executable by others. */
    var S_IXOTH: number;
    /**
     * When set, a memory file mapping is used to access the file. This flag
     * is available on Windows operating systems only. On other operating systems,
     * this flag is ignored.
     */
    var UV_FS_O_FILEMAP: number;
  }
  /**
   * Tests a user's permissions for the file or directory specified by `path`.
   * The `mode` argument is an optional integer that specifies the accessibility
   * checks to be performed. Check `File access constants` for possible values
   * of `mode`. It is possible to create a mask consisting of the bitwise OR of
   * two or more values (e.g. `fs.constants.W_OK | fs.constants.R_OK`).
   *
   * The final argument, `callback`, is a callback function that is invoked with
   * a possible error argument. If any of the accessibility checks fail, the error
   * argument will be an `Error` object. The following examples check if`package.json` exists, and if it is readable or writable.
   *
   * ```js
   * import { access, constants } from 'fs';
   *
   * const file = 'package.json';
   *
   * // Check if the file exists in the current directory.
   * access(file, constants.F_OK, (err) => {
   *   console.log(`${file} ${err ? 'does not exist' : 'exists'}`);
   * });
   *
   * // Check if the file is readable.
   * access(file, constants.R_OK, (err) => {
   *   console.log(`${file} ${err ? 'is not readable' : 'is readable'}`);
   * });
   *
   * // Check if the file is writable.
   * access(file, constants.W_OK, (err) => {
   *   console.log(`${file} ${err ? 'is not writable' : 'is writable'}`);
   * });
   *
   * // Check if the file exists in the current directory, and if it is writable.
   * access(file, constants.F_OK | constants.W_OK, (err) => {
   *   if (err) {
   *     console.error(
   *       `${file} ${err.code === 'ENOENT' ? 'does not exist' : 'is read-only'}`);
   *   } else {
   *     console.log(`${file} exists, and it is writable`);
   *   }
   * });
   * ```
   *
   * Do not use `fs.access()` to check for the accessibility of a file before calling`fs.open()`, `fs.readFile()` or `fs.writeFile()`. Doing
   * so introduces a race condition, since other processes may change the file's
   * state between the two calls. Instead, user code should open/read/write the
   * file directly and handle the error raised if the file is not accessible.
   *
   * **write (NOT RECOMMENDED)**
   *
   * ```js
   * import { access, open, close } from 'fs';
   *
   * access('myfile', (err) => {
   *   if (!err) {
   *     console.error('myfile already exists');
   *     return;
   *   }
   *
   *   open('myfile', 'wx', (err, fd) => {
   *     if (err) throw err;
   *
   *     try {
   *       writeMyData(fd);
   *     } finally {
   *       close(fd, (err) => {
   *         if (err) throw err;
   *       });
   *     }
   *   });
   * });
   * ```
   *
   * **write (RECOMMENDED)**
   *
   * ```js
   * import { open, close } from 'fs';
   *
   * open('myfile', 'wx', (err, fd) => {
   *   if (err) {
   *     if (err.code === 'EEXIST') {
   *       console.error('myfile already exists');
   *       return;
   *     }
   *
   *     throw err;
   *   }
   *
   *   try {
   *     writeMyData(fd);
   *   } finally {
   *     close(fd, (err) => {
   *       if (err) throw err;
   *     });
   *   }
   * });
   * ```
   *
   * **read (NOT RECOMMENDED)**
   *
   * ```js
   * import { access, open, close } from 'fs';
   * access('myfile', (err) => {
   *   if (err) {
   *     if (err.code === 'ENOENT') {
   *       console.error('myfile does not exist');
   *       return;
   *     }
   *
   *     throw err;
   *   }
   *
   *   open('myfile', 'r', (err, fd) => {
   *     if (err) throw err;
   *
   *     try {
   *       readMyData(fd);
   *     } finally {
   *       close(fd, (err) => {
   *         if (err) throw err;
   *       });
   *     }
   *   });
   * });
   * ```
   *
   * **read (RECOMMENDED)**
   *
   * ```js
   * import { open, close } from 'fs';
   *
   * open('myfile', 'r', (err, fd) => {
   *   if (err) {
   *     if (err.code === 'ENOENT') {
   *       console.error('myfile does not exist');
   *       return;
   *     }
   *
   *     throw err;
   *   }
   *
   *   try {
   *     readMyData(fd);
   *   } finally {
   *     close(fd, (err) => {
   *       if (err) throw err;
   *     });
   *   }
   * });
   * ```
   *
   * The "not recommended" examples above check for accessibility and then use the
   * file; the "recommended" examples are better because they use the file directly
   * and handle the error, if any.
   *
   * In general, check for the accessibility of a file only if the file will not be
   * used directly, for example when its accessibility is a signal from another
   * process.
   *
   * On Windows, access-control policies (ACLs) on a directory may limit access to
   * a file or directory. The `fs.access()` function, however, does not check the
   * ACL and therefore may report that a path is accessible even if the ACL restricts
   * the user from reading or writing to it.
   * @since v0.0.67
   * @param [mode=fs.constants.F_OK]
   */
  function access(
    path: PathLike,
    mode: number | undefined,
    callback: NoParamCallback
  ): void;
  /**
   * Asynchronously tests a user's permissions for the file specified by path.
   * @param path A path to a file or directory. If a URL is provided, it must use the `file:` protocol.
   */
  function access(path: PathLike, callback: NoParamCallback): void;
  // namespace access {
  //   /**
  //    * Asynchronously tests a user's permissions for the file specified by path.
  //    * @param path A path to a file or directory. If a URL is provided, it must use the `file:` protocol.
  //    * URL support is _experimental_.
  //    */
  //   function __promisify__(path: PathLike, mode?: number): Promise<void>;
  // }
  /**
   * Synchronously tests a user's permissions for the file or directory specified
   * by `path`. The `mode` argument is an optional integer that specifies the
   * accessibility checks to be performed. Check `File access constants` for
   * possible values of `mode`. It is possible to create a mask consisting of
   * the bitwise OR of two or more values
   * (e.g. `fs.constants.W_OK | fs.constants.R_OK`).
   *
   * If any of the accessibility checks fail, an `Error` will be thrown. Otherwise,
   * the method will return `undefined`.
   *
   * ```js
   * import { accessSync, constants } from 'fs';
   *
   * try {
   *   accessSync('etc/passwd', constants.R_OK | constants.W_OK);
   *   console.log('can read/write');
   * } catch (err) {
   *   console.error('no access!');
   * }
   * ```
   * @since v0.0.67
   * @param [mode=fs.constants.F_OK]
   */
  function accessSync(path: PathLike, mode?: number): void;

  /**
   * Forces all currently queued I/O operations associated with the file to the
   * operating system's synchronized I/O completion state. Refer to the POSIX [`fdatasync(2)`](http://man7.org/linux/man-pages/man2/fdatasync.2.html) documentation for details. No arguments other
   * than a possible
   * exception are given to the completion callback.
   * @since v0.0.67
   */
  function fdatasync(fd: number, callback: NoParamCallback): void;
  // namespace fdatasync {
  //   /**
  //    * Asynchronous fdatasync(2) - synchronize a file's in-core state with storage device.
  //    * @param fd A file descriptor.
  //    */
  //   function __promisify__(fd: number): Promise<void>;
  // }
  /**
   * Forces all currently queued I/O operations associated with the file to the
   * operating system's synchronized I/O completion state. Refer to the POSIX [`fdatasync(2)`](http://man7.org/linux/man-pages/man2/fdatasync.2.html) documentation for details. Returns `undefined`.
   * @since v0.0.67
   */
  function fdatasyncSync(fd: number): void;
  /**
   * Asynchronously copies `src` to `dest`. By default, `dest` is overwritten if it
   * already exists. No arguments other than a possible exception are given to the
   * callback function. Node.js makes no guarantees about the atomicity of the copy
   * operation. If an error occurs after the destination file has been opened for
   * writing, Node.js will attempt to remove the destination.
   *
   * `mode` is an optional integer that specifies the behavior
   * of the copy operation. It is possible to create a mask consisting of the bitwise
   * OR of two or more values (e.g.`fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE`).
   *
   * * `fs.constants.COPYFILE_EXCL`: The copy operation will fail if `dest` already
   * exists.
   * * `fs.constants.COPYFILE_FICLONE`: The copy operation will attempt to create a
   * copy-on-write reflink. If the platform does not support copy-on-write, then a
   * fallback copy mechanism is used.
   * * `fs.constants.COPYFILE_FICLONE_FORCE`: The copy operation will attempt to
   * create a copy-on-write reflink. If the platform does not support
   * copy-on-write, then the operation will fail.
   *
   * ```js
   * import { copyFile, constants } from 'fs';
   *
   * function callback(err) {
   *   if (err) throw err;
   *   console.log('source.txt was copied to destination.txt');
   * }
   *
   * // destination.txt will be created or overwritten by default.
   * copyFile('source.txt', 'destination.txt', callback);
   *
   * // By using COPYFILE_EXCL, the operation will fail if destination.txt exists.
   * copyFile('source.txt', 'destination.txt', constants.COPYFILE_EXCL, callback);
   * ```
   * @since v0.0.67
   * @param src source filename to copy
   * @param dest destination filename of the copy operation
   * @param [mode=0] modifiers for copy operation.
   */
  function copyFile(
    src: PathLike,
    dest: PathLike,
    callback: NoParamCallback
  ): void;
  function copyFile(
    src: PathLike,
    dest: PathLike,
    mode: number,
    callback: NoParamCallback
  ): void;
  // namespace copyFile {
  //   function __promisify__(
  //     src: PathLike,
  //     dst: PathLike,
  //     mode?: number
  //   ): Promise<void>;
  // }
  /**
   * Synchronously copies `src` to `dest`. By default, `dest` is overwritten if it
   * already exists. Returns `undefined`. Node.js makes no guarantees about the
   * atomicity of the copy operation. If an error occurs after the destination file
   * has been opened for writing, Node.js will attempt to remove the destination.
   *
   * `mode` is an optional integer that specifies the behavior
   * of the copy operation. It is possible to create a mask consisting of the bitwise
   * OR of two or more values (e.g.`fs.constants.COPYFILE_EXCL | fs.constants.COPYFILE_FICLONE`).
   *
   * * `fs.constants.COPYFILE_EXCL`: The copy operation will fail if `dest` already
   * exists.
   * * `fs.constants.COPYFILE_FICLONE`: The copy operation will attempt to create a
   * copy-on-write reflink. If the platform does not support copy-on-write, then a
   * fallback copy mechanism is used.
   * * `fs.constants.COPYFILE_FICLONE_FORCE`: The copy operation will attempt to
   * create a copy-on-write reflink. If the platform does not support
   * copy-on-write, then the operation will fail.
   *
   * ```js
   * import { copyFileSync, constants } from 'fs';
   *
   * // destination.txt will be created or overwritten by default.
   * copyFileSync('source.txt', 'destination.txt');
   * console.log('source.txt was copied to destination.txt');
   *
   * // By using COPYFILE_EXCL, the operation will fail if destination.txt exists.
   * copyFileSync('source.txt', 'destination.txt', constants.COPYFILE_EXCL);
   * ```
   * @since v0.0.67
   * @param src source filename to copy
   * @param dest destination filename of the copy operation
   * @param [mode=0] modifiers for copy operation.
   */
  function copyFileSync(src: PathLike, dest: PathLike, mode?: number): void;
  /**
   * Write an array of `ArrayBufferView`s to the file specified by `fd` using`writev()`.
   *
   * `position` is the offset from the beginning of the file where this data
   * should be written. If `typeof position !== 'number'`, the data will be written
   * at the current position.
   *
   * The callback will be given three arguments: `err`, `bytesWritten`, and`buffers`. `bytesWritten` is how many bytes were written from `buffers`.
   *
   * If this method is `util.promisify()` ed, it returns a promise for an`Object` with `bytesWritten` and `buffers` properties.
   *
   *
   * On Linux, positional writes don't work when the file is opened in append mode.
   * The kernel ignores the position argument and always appends the data to
   * the end of the file.
   * @since v0.0.67
   */
  function writev(
    fd: number,
    buffers: ReadonlyArray<ArrayBufferView>,
    cb: (
      err: SystemError | null,
      bytesWritten: number,
      buffers: ArrayBufferView[]
    ) => void
  ): void;
  function writev(
    fd: number,
    buffers: ReadonlyArray<ArrayBufferView>,
    position: number,
    cb: (
      err: SystemError | null,
      bytesWritten: number,
      buffers: ArrayBufferView[]
    ) => void
  ): void;
  interface WriteVResult {
    bytesWritten: number;
    buffers: ArrayBufferView[];
  }
  // namespace writev {
  //   function __promisify__(
  //     fd: number,
  //     buffers: ReadonlyArray<ArrayBufferView>,
  //     position?: number
  //   ): Promise<WriteVResult>;
  // }
  /**
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link writev}.
   * @since v0.0.67
   * @return The number of bytes written.
   */
  function writevSync(
    fd: number,
    buffers: ReadonlyArray<ArrayBufferView>,
    position?: number
  ): number;
  /**
   * Read from a file specified by `fd` and write to an array of `ArrayBufferView`s
   * using `readv()`.
   *
   * `position` is the offset from the beginning of the file from where data
   * should be read. If `typeof position !== 'number'`, the data will be read
   * from the current position.
   *
   * The callback will be given three arguments: `err`, `bytesRead`, and`buffers`. `bytesRead` is how many bytes were read from the file.
   *
   * If this method is invoked as its `util.promisify()` ed version, it returns
   * a promise for an `Object` with `bytesRead` and `buffers` properties.
   * @since v0.0.67
   */
  function readv(
    fd: number,
    buffers: ReadonlyArray<ArrayBufferView>,
    cb: (
      err: SystemError | null,
      bytesRead: number,
      buffers: ArrayBufferView[]
    ) => void
  ): void;
  function readv(
    fd: number,
    buffers: ReadonlyArray<ArrayBufferView>,
    position: number,
    cb: (
      err: SystemError | null,
      bytesRead: number,
      buffers: ArrayBufferView[]
    ) => void
  ): void;
  interface ReadVResult {
    bytesRead: number;
    buffers: ArrayBufferView[];
  }
  // namespace readv {
  //   function __promisify__(
  //     fd: number,
  //     buffers: ReadonlyArray<ArrayBufferView>,
  //     position?: number
  //   ): Promise<ReadVResult>;
  // }
  /**
   * For detailed information, see the documentation of the asynchronous version of
   * this API: {@link readv}.
   * @since v0.0.67
   * @return The number of bytes read.
   */
  function readvSync(
    fd: number,
    buffers: ReadonlyArray<ArrayBufferView>,
    position?: number
  ): number;
  interface OpenDirOptions {
    encoding?: BufferEncoding | undefined;
    /**
     * Number of directory entries that are buffered
     * internally when reading from the directory. Higher values lead to better
     * performance but higher memory usage.
     * @default 32
     */
    bufferSize?: number | undefined;
  }

  interface BigIntStats extends StatsBase<bigint> {
    atimeNs: bigint;
    mtimeNs: bigint;
    ctimeNs: bigint;
    birthtimeNs: bigint;
  }
  interface BigIntOptions {
    bigint: true;
  }
  interface StatOptions {
    bigint?: boolean | undefined;
  }
  interface StatSyncOptions extends StatOptions {
    throwIfNoEntry?: boolean | undefined;
  }
  interface CopyOptions {
    /**
     * Dereference symlinks
     * @default false
     */
    dereference?: boolean;
    /**
     * When `force` is `false`, and the destination
     * exists, throw an error.
     * @default false
     */
    errorOnExist?: boolean;
    /**
     * function to filter copied files/directories. Return
     * `true` to copy the item, `false` to ignore it.
     */
    filter?(source: string, destination: string): boolean;
    /**
     * Overwrite existing file or directory. _The copy
     * operation will ignore errors if you set this to false and the destination
     * exists. Use the `errorOnExist` option to change this behavior.
     * @default true
     */
    force?: boolean;
    /**
     * When `true` timestamps from `src` will
     * be preserved.
     * @default false
     */
    preserveTimestamps?: boolean;
    /**
     * Copy directories recursively.
     * @default false
     */
    recursive?: boolean;
  }
}

declare module "node:fs" {
  import * as fs from "fs";
  export = fs;
}


// ./html-rewriter.d.ts

declare namespace HTMLRewriterTypes {
  interface HTMLRewriterElementContentHandlers {
    element?(element: Element): void | Promise<void>;
    comments?(comment: Comment): void | Promise<void>;
    text?(text: Text): void | Promise<void>;
  }

  interface HTMLRewriterDocumentContentHandlers {
    doctype?(doctype: Doctype): void | Promise<void>;
    comments?(comment: Comment): void | Promise<void>;
    text?(text: Text): void | Promise<void>;
    end?(end: DocumentEnd): void | Promise<void>;
  }

  interface Text {
    readonly text: string;
    readonly lastInTextNode: boolean;
    readonly removed: boolean;
    before(content: Content, options?: ContentOptions): Text;
    after(content: Content, options?: ContentOptions): Text;
    replace(content: Content, options?: ContentOptions): Text;
    remove(): Text;
  }

  interface Doctype {
    readonly name: string | null;
    readonly publicId: string | null;
    readonly systemId: string | null;
  }

  interface DocumentEnd {
    append(content: Content, options?: ContentOptions): DocumentEnd;
  }

  interface ContentOptions {
    html?: boolean;
  }
  type Content = string;

  interface Comment {
    text: string;
    readonly removed: boolean;
    before(content: Content, options?: ContentOptions): Comment;
    after(content: Content, options?: ContentOptions): Comment;
    replace(content: Content, options?: ContentOptions): Comment;
    remove(): Comment;
  }

  interface Element {
    tagName: string;
    readonly attributes: IterableIterator<string[]>;
    readonly removed: boolean;
    readonly namespaceURI: string;
    getAttribute(name: string): string | null;
    hasAttribute(name: string): boolean;
    setAttribute(name: string, value: string): Element;
    removeAttribute(name: string): Element;
    before(content: Content, options?: ContentOptions): Element;
    after(content: Content, options?: ContentOptions): Element;
    prepend(content: Content, options?: ContentOptions): Element;
    append(content: Content, options?: ContentOptions): Element;
    replace(content: Content, options?: ContentOptions): Element;
    remove(): Element;
    removeAndKeepContent(): Element;
    setInnerContent(content: Content, options?: ContentOptions): Element;
    onEndTag(handler: (tag: EndTag) => void | Promise<void>): void;
  }

  interface EndTag {
    name: string;
    before(content: Content, options?: ContentOptions): EndTag;
    after(content: Content, options?: ContentOptions): EndTag;
    remove(): EndTag;
  }
}

/**
 * [HTMLRewriter](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter?bun) is a fast API for transforming HTML.
 *
 * Bun leverages a native implementation powered by [lol-html](https://github.com/cloudflare/lol-html).
 *
 * HTMLRewriter can be used to transform HTML in a variety of ways, including:
 * * Rewriting URLs
 * * Adding meta tags
 * * Removing elements
 * * Adding elements to the head
 *
 * @example
 * ```ts
 * const rewriter = new HTMLRewriter().on('a[href]', {
 *   element(element: Element) {
 *     // Rewrite all the URLs to this youtube video
 *     element.setAttribute('href', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
 *   }
 * });
 * rewriter.transform(await fetch("https://remix.run"));
 * ```
 */
declare class HTMLRewriter {
  constructor();
  on(
    selector: string,
    handlers: HTMLRewriterTypes.HTMLRewriterElementContentHandlers
  ): HTMLRewriter;
  onDocument(
    handlers: HTMLRewriterTypes.HTMLRewriterDocumentContentHandlers
  ): HTMLRewriter;
  /**
   * @param input - The HTML to transform
   * @returns A new {@link Response} with the transformed HTML
   */
  transform(input: Response): Response;
}


// ./globals.d.ts

type Encoding = "utf-8" | "windows-1252" | "utf-16";

interface console {
  assert(condition?: boolean, ...data: any[]): void;
  clear(): void;
  /**
   * Increment a [count](https://www.youtube.com/watch?v=2AoxCkySv34&t=22s)
   * @param label label counter
   */
  count(label?: string): void;
  countReset(label?: string): void;
  debug(...data: any[]): void;
  dir(item?: any, options?: any): void;
  dirxml(...data: any[]): void;
  /**
   * Log to stderr in your terminal
   *
   * Appears in red
   *
   * @param data something to display
   */
  error(...data: any[]): void;
  /** Does nothing currently */
  group(...data: any[]): void;
  /** Does nothing currently */
  groupCollapsed(...data: any[]): void;
  /** Does nothing currently */
  groupEnd(): void;
  info(...data: any[]): void;
  log(...data: any[]): void;
  /** Does nothing currently */
  table(tabularData?: any, properties?: string[]): void;
  /**
   * Begin a timer to log with {@link console.timeEnd}
   *
   * @param label - The label to use for the timer
   *
   * ```ts
   *  console.time("how long????");
   * for (let i = 0; i < 999999; i++) {
   *    // do stuff
   *    let x = i * i;
   * }
   * console.timeEnd("how long????");
   * ```
   */
  time(label?: string): void;
  /**
   * End a timer to log with {@link console.time}
   *
   * @param label - The label to use for the timer
   *
   * ```ts
   *  console.time("how long????");
   * for (let i = 0; i < 999999; i++) {
   *  // do stuff
   *  let x = i * i;
   * }
   * console.timeEnd("how long????");
   * ```
   */
  timeEnd(label?: string): void;
  timeLog(label?: string, ...data: any[]): void;
  timeStamp(label?: string): void;
  trace(...data: any[]): void;
  warn(...data: any[]): void;
}

declare var console: console;

interface ImportMeta {
  /**
   * `file://` url string for the current module.
   *
   * @example
   * ```ts
   * console.log(import.meta.url);
   * "file:///Users/me/projects/my-app/src/my-app.ts"
   * ```
   */
  url: string;
  /**
   * Absolute path to the source file
   */
  path: string;
  /**
   * Absolute path to the directory containing the source file.
   *
   * Does not have a trailing slash
   */
  dir: string;
  /**
   * Filename of the source file
   */
  file: string;
  /**
   * Resolve a module ID the same as if you imported it
   *
   * On failure, throws a `ResolveError`
   */
  resolve(moduleId: string): Promise<string>;
  /**
   * Resolve a `moduleId` as though it were imported from `parent`
   *
   * On failure, throws a `ResolveError`
   */
  // tslint:disable-next-line:unified-signatures
  resolve(moduleId: string, parent: string): Promise<string>;
}

interface EncodeIntoResult {
  /**
   * The read Unicode code units of input.
   */
  read: number;
  /**
   * The written UTF-8 bytes of output.
   */
  written: number;
}

interface Process {
  /**
   * The current version of Bun
   */
  version: string;
  /**
   * Run a function on the next tick of the event loop
   *
   * This is the same as {@link queueMicrotask}
   *
   * @param callback - The function to run
   */
  nextTick(callback: (...args: any) => any, ...args: any): void;
  versions: Record<string, string>;
  ppid: number;
  pid: number;
  arch:
    | "arm64"
    | "arm"
    | "ia32"
    | "mips"
    | "mipsel"
    | "ppc"
    | "ppc64"
    | "s390"
    | "s390x"
    | "x32"
    | "x64"
    | "x86";
  platform: "darwin" | "freebsd" | "linux" | "openbsd" | "sunos" | "win32";
  argv: string[];
  // execArgv: string[];
  env: Record<string, string> & {
    NODE_ENV: string;
  };
  // execPath: string;
  // abort(): void;
  chdir(directory: string): void;
  cwd(): string;
  exit(code?: number): void;
  getgid(): number;
  setgid(id: number | string): void;
  getuid(): number;
  setuid(id: number | string): void;
}

declare var process: Process;

interface BlobInterface {
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<JSON>;
}

type BlobPart = string | Blob | ArrayBufferView | ArrayBuffer;
interface BlobPropertyBag {
  /** Set a default "type" */
  type?: string;

  /** Not implemented in Bun yet. */
  endings?: "transparent" | "native";
}

/**
 * This Fetch API interface allows you to perform various actions on HTTP
 * request and response headers. These actions include retrieving, setting,
 * adding to, and removing. A Headers object has an associated header list,
 * which is initially empty and consists of zero or more name and value
 * pairs.
 *
 * You can add to this using methods like append()
 *
 * In all methods of this interface, header names are matched by
 * case-insensitive byte sequence.
 */
interface Headers {
  append(name: string, value: string): void;
  delete(name: string): void;
  get(name: string): string | null;
  has(name: string): boolean;
  set(name: string, value: string): void;
  forEach(
    callbackfn: (value: string, key: string, parent: Headers) => void,
    thisArg?: any
  ): void;
}

declare var Headers: {
  prototype: Headers;
  new (init?: HeadersInit): Headers;
};

type HeadersInit = Array<[string, string]> | Record<string, string> | Headers;
type ResponseType =
  | "basic"
  | "cors"
  | "default"
  | "error"
  | "opaque"
  | "opaqueredirect";

declare class Blob implements BlobInterface {
  /**
   * Create a new [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob)
   *
   * @param `parts` - An array of strings, numbers, TypedArray, or [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob) objects
   * @param `options` - An object containing properties to be added to the [Blob](https://developer.mozilla.org/en-US/docs/Web/API/Blob)
   */
  constructor(parts?: BlobPart[] | Blob, options?: BlobPropertyBag);
  /**
   * Create a new view **without 🚫 copying** the underlying data.
   *
   * Similar to [`TypedArray.subarray`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray/subarray)
   *
   * @param begin The index that sets the beginning of the view.
   * @param end The index that sets the end of the view.
   *
   */
  slice(begin?: number, end?: number): Blob;

  /**
   * Read the data from the blob as a string. It will be decoded from UTF-8.
   */
  text(): Promise<string>;

  /**
   * Read the data from the blob as an ArrayBuffer.
   *
   * This copies the data into a new ArrayBuffer.
   */
  arrayBuffer(): Promise<ArrayBuffer>;

  /**
   * Read the data from the blob as a JSON object.
   *
   * This first decodes the data from UTF-8, then parses it as JSON.
   *
   */
  json(): Promise<JSON>;

  type: string;
  size: number;
}

interface ResponseInit {
  headers?: HeadersInit;
  /** @default 200 */
  status?: number;

  /** @default "OK" */
  statusText?: string;
}

/**
 * Represents an HTTP [Response](https://developer.mozilla.org/en-US/docs/Web/API/Response)
 *
 * Use it to get the body of the response, the status code, and other information.
 *
 * @example
 * ```ts
 * const response: Response = await fetch("https://remix.run");
 * await response.text();
 * ```
 * @example
 * ```ts
 * const response: Response = await fetch("https://remix.run");
 * await Bun.write("remix.html", response);
 * ```
 */
declare class Response implements BlobInterface {
  constructor(body: BlobPart | BlobPart[], options?: ResponseInit);

  /**
   * Create a new {@link Response} with a JSON body
   *
   * @param body - The body of the response
   * @param options - options to pass to the response
   *
   * @example
   *
   * ```ts
   * const response = Response.json({hi: "there"});
   * console.assert(
   *   await response.text(),
   *   `{"hi":"there"}`
   * );
   * ```
   * -------
   *
   * This is syntactic sugar for:
   * ```js
   *  new Response(JSON.stringify(body), {headers: { "Content-Type": "application/json" }})
   * ```
   * @link https://github.com/whatwg/fetch/issues/1389
   */
  static json(body?: any, options?: ResponseInit | number): Response;
  /**
   * Create a new {@link Response} that redirects to url
   *
   * @param url - the URL to redirect to
   * @param status - the HTTP status code to use for the redirect
   */
  // tslint:disable-next-line:unified-signatures
  static redirect(url: string, status?: number): Response;

  /**
   * Create a new {@link Response} that redirects to url
   *
   * @param url - the URL to redirect to
   * @param options - options to pass to the response
   */
  // tslint:disable-next-line:unified-signatures
  static redirect(url: string, options?: ResponseInit): Response;

  /**
   * Create a new {@link Response} that has a network error
   */
  static error(): Response;

  /**
   * HTTP [Headers](https://developer.mozilla.org/en-US/docs/Web/API/Headers) sent with the response.
   *
   * @example
   * ```ts
   * const {headers} = await fetch("https://remix.run");
   * headers.get("Content-Type");
   * headers.get("Content-Length");
   * headers.get("Set-Cookie");
   * ```
   */
  readonly headers: Headers;

  /**
   * Has the body of the response already been consumed?
   */
  readonly bodyUsed: boolean;

  /**
   * Read the data from the Response as a string. It will be decoded from UTF-8.
   *
   * When the body is valid latin1, this operation is zero copy.
   */
  text(): Promise<string>;

  /**
   * Read the data from the Response as a string. It will be decoded from UTF-8.
   *
   * When the body is valid latin1, this operation is zero copy.
   */
  arrayBuffer(): Promise<ArrayBuffer>;

  /**
   * Read the data from the Response as a JSON object.
   *
   * This first decodes the data from UTF-8, then parses it as JSON.
   *
   */
  json(): Promise<JSON>;

  /**
   * Read the data from the Response as a Blob.
   *
   * This allows you to reuse the underlying data.
   *
   * @returns Promise<Blob> - The body of the response as a {@link Blob}.
   */
  blob(): Promise<Blob>;

  readonly ok: boolean;
  readonly redirected: boolean;
  /**
   * HTTP status code
   *
   * @example
   * 200
   *
   * 0 for network errors
   */
  readonly status: number;
  readonly statusText: string;
  readonly type: ResponseType;
  /** HTTP url as a string */
  readonly url: string;

  /** Copy the Response object into a new Response, including the body */
  clone(): Response;
}

type RequestCache =
  | "default"
  | "force-cache"
  | "no-cache"
  | "no-store"
  | "only-if-cached"
  | "reload";
type RequestCredentials = "include" | "omit" | "same-origin";
type RequestDestination =
  | ""
  | "audio"
  | "audioworklet"
  | "document"
  | "embed"
  | "font"
  | "frame"
  | "iframe"
  | "image"
  | "manifest"
  | "object"
  | "paintworklet"
  | "report"
  | "script"
  | "sharedworker"
  | "style"
  | "track"
  | "video"
  | "worker"
  | "xslt";
type RequestMode = "cors" | "navigate" | "no-cors" | "same-origin";
type RequestRedirect = "error" | "follow" | "manual";
type ReferrerPolicy =
  | ""
  | "no-referrer"
  | "no-referrer-when-downgrade"
  | "origin"
  | "origin-when-cross-origin"
  | "same-origin"
  | "strict-origin"
  | "strict-origin-when-cross-origin"
  | "unsafe-url";
type RequestInfo = Request | string;

type BodyInit = XMLHttpRequestBodyInit;
type XMLHttpRequestBodyInit = Blob | BufferSource | string;

interface RequestInit {
  /**
   * A BodyInit object or null to set request's body.
   */
  body?: BodyInit | null;
  /**
   * A string indicating how the request will interact with the browser's cache to set request's cache.
   *
   * Note: as of Bun v0.0.74, this is not implemented yet.
   */
  cache?: RequestCache;
  /**
   * A string indicating whether credentials will be sent with the request always, never, or only when sent to a same-origin URL. Sets request's credentials.
   */
  credentials?: RequestCredentials;
  /**
   * A Headers object, an object literal, or an array of two-item arrays to set request's headers.
   */
  headers?: HeadersInit;
  /**
   * A cryptographic hash of the resource to be fetched by request. Sets request's integrity.
   *
   * Note: as of Bun v0.0.74, this is not implemented yet.
   */
  integrity?: string;
  /**
   * A boolean to set request's keepalive.
   *
   * Note: as of Bun v0.0.74, this is not implemented yet.
   */
  keepalive?: boolean;
  /**
   * A string to set request's method.
   */
  method?: string;
  /**
   * A string to indicate whether the request will use CORS, or will be restricted to same-origin URLs. Sets request's mode.
   */
  mode?: RequestMode;
  /**
   * A string indicating whether request follows redirects, results in an error upon encountering a redirect, or returns the redirect (in an opaque fashion). Sets request's redirect.
   */
  redirect?: RequestRedirect;
  /**
   * A string whose value is a same-origin URL, "about:client", or the empty string, to set request's referrer.
   */
  referrer?: string;
  /**
   * A referrer policy to set request's referrerPolicy.
   */
  referrerPolicy?: ReferrerPolicy;
  /**
   * An AbortSignal to set request's signal.
   *
   * Note: as of Bun v0.0.74, this is not implemented yet.
   */
  signal?: AbortSignal | null;
  /**
   * Can only be null. Used to disassociate request from any Window.
   *
   * This does nothing in Bun
   */
  window?: any;
}

/**
 * [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) represents an HTTP request.
 *
 * @example
 * ```ts
 * const request = new Request("https://remix.run/");
 * await fetch(request);
 * ```
 *
 * @example
 * ```ts
 * const request = new Request("https://remix.run/");
 * await fetch(request);
 * ```
 */
declare class Request implements BlobInterface {
  constructor(requestInfo: RequestInfo, requestInit?: RequestInit);

  /**
   * Read or write the HTTP headers for this request.
   *
   * @example
   * ```ts
   * const request = new Request("https://remix.run/");
   * request.headers.set("Content-Type", "application/json");
   * request.headers.set("Accept", "application/json");
   * await fetch(request);
   * ```
   */
  headers: Headers;

  /**
   * The URL (as a string) corresponding to the HTTP request
   * @example
   * ```ts
   * const request = new Request("https://remix.run/");
   * request.url; // "https://remix.run/"
   * ```
   */
  readonly url: string;

  /**
   * Consume the [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) body as a string. It will be decoded from UTF-8.
   *
   * When the body is valid latin1, this operation is zero copy.
   */
  text(): Promise<string>;

  /**
   * Consume the [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) body as an ArrayBuffer.
   *
   */
  arrayBuffer(): Promise<ArrayBuffer>;

  /**
   * Consume the [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) body as a JSON object.
   *
   * This first decodes the data from UTF-8, then parses it as JSON.
   *
   */
  json(): Promise<JSON>;

  /**
   * Consume the [`Request`](https://developer.mozilla.org/en-US/docs/Web/API/Request) body as a `Blob`.
   *
   * This allows you to reuse the underlying data.
   *
   */
  blob(): Promise<Blob>;

  /**
   * Returns the cache mode associated with request, which is a string indicating how the request will interact with the browser's cache when fetching.
   */
  readonly cache: RequestCache;
  /**
   * Returns the credentials mode associated with request, which is a string indicating whether credentials will be sent with the request always, never, or only when sent to a same-origin URL.
   */
  readonly credentials: RequestCredentials;
  /**
   * Returns the kind of resource requested by request, e.g., "document" or "script".
   *
   * In Bun, this always returns "navigate".
   */
  readonly destination: RequestDestination;
  /**
   * Returns request's subresource integrity metadata, which is a cryptographic hash of the resource being fetched. Its value consists of multiple hashes separated by whitespace. [SRI]
   *
   * This does nothing in Bun right now.
   */
  readonly integrity: string;
  /**
   * Returns a boolean indicating whether or not request can outlive the global in which it was created.
   *
   * In Bun, this always returns false.
   */
  readonly keepalive: boolean;
  /**
   * Returns request's HTTP method, which is "GET" by default.
   */
  readonly method: string;
  /**
   * Returns the mode associated with request, which is a string indicating whether the request will use CORS, or will be restricted to same-origin URLs.
   */
  readonly mode: RequestMode;
  /**
   * Returns the redirect mode associated with request, which is a string indicating how redirects for the request will be handled during fetching. A request will follow redirects by default.
   */
  readonly redirect: RequestRedirect;
  /**
   * Returns the referrer of request. Its value can be a same-origin URL
   * if explicitly set in init, the empty string to indicate no referrer,
   * and "about:client" when defaulting to the global's default. This is
   * used during fetching to determine the value of the `Referer` header
   * of the request being made.
   */
  readonly referrer: string;
  /**
   * Returns the referrer policy associated with request. This is used during fetching to compute the value of the request's referrer.
   */
  readonly referrerPolicy: ReferrerPolicy;
  /**
   * Returns the signal associated with request, which is an AbortSignal object indicating whether or not request has been aborted, and its abort event handler.
   *
   * Note: this is **not implemented yet**. The cake is a lie.
   */
  readonly signal: AbortSignal;

  /** Copy the Request object into a new Request, including the body */
  clone(): Request;
}

interface Crypto {
  getRandomValues(array: TypedArray): void;
  /**
   * Generate a cryptographically secure random UUID.
   *
   * @example
   *
   * ```js
   * crypto.randomUUID()
   * '5e6adf82-f516-4468-b1e1-33d6f664d7dc'
   * ```
   */
  randomUUID(): string;
}

declare var crypto: Crypto;

/**
 * [`atob`](https://developer.mozilla.org/en-US/docs/Web/API/atob) converts ascii text into base64.
 *
 * @param asciiText The ascii text to convert.
 */
declare function atob(asciiText: string): string;

/**
 * [`btoa`](https://developer.mozilla.org/en-US/docs/Web/API/btoa) decodes base64 into ascii text.
 *
 * @param base64Text The base64 text to convert.
 */
declare function btoa(base64Text: string): string;

/**
 * An implementation of the [WHATWG Encoding Standard](https://encoding.spec.whatwg.org/) `TextEncoder` API. All
 * instances of `TextEncoder` only support UTF-8 encoding.
 *
 * ```js
 * const encoder = new TextEncoder();
 * const uint8array = encoder.encode('this is some data');
 * ```
 *
 */
declare class TextEncoder {
  constructor(encoding?: "utf-8");
  readonly encoding: "utf-8";

  /**
   * UTF-8 encodes the `input` string and returns a `Uint8Array` containing the
   * encoded bytes.
   * @param [input='an empty string'] The text to encode.
   */
  encode(input?: string): Uint8Array;
  /**
   * UTF-8 encodes the `src` string to the `dest` Uint8Array and returns an object
   * containing the read Unicode code units and written UTF-8 bytes.
   *
   * ```js
   * const encoder = new TextEncoder();
   * const src = 'this is some data';
   * const dest = new Uint8Array(10);
   * const { read, written } = encoder.encodeInto(src, dest);
   * ```
   * @param src The text to encode.
   * @param dest The array to hold the encode result.
   */
  encodeInto(src?: string, dest?: TypedArray): EncodeIntoResult;
}

declare class TextDecoder {
  constructor(
    encoding?: Encoding,
    options?: { fatal?: boolean; ignoreBOM?: boolean }
  );

  encoding: Encoding;
  ignoreBOM: boolean;
  fatal: boolean;

  /**
   * Decodes the `input` and returns a string. If `options.stream` is `true`, any
   * incomplete byte sequences occurring at the end of the `input` are buffered
   * internally and emitted after the next call to `textDecoder.decode()`.
   *
   * If `textDecoder.fatal` is `true`, decoding errors that occur will result in a`TypeError` being thrown.
   * @param input An `ArrayBuffer`, `DataView` or `TypedArray` instance containing the encoded data.
   */
  decode(input?: TypedArray | ArrayBuffer): string;
}

/**
 * ShadowRealms are a distinct global environment, with its own global object
 * containing its own intrinsics and built-ins (standard objects that are not
 * bound to global variables, like the initial value of Object.prototype).
 *
 *
 * @example
 *
 * ```js
 * const red = new ShadowRealm();
 *
 * // realms can import modules that will execute within it's own environment.
 * // When the module is resolved, it captured the binding value, or creates a new
 * // wrapped function that is connected to the callable binding.
 * const redAdd = await red.importValue('./inside-code.js', 'add');
 *
 * // redAdd is a wrapped function exotic object that chains it's call to the
 * // respective imported binding.
 * let result = redAdd(2, 3);
 *
 * console.assert(result === 5); // yields true
 *
 * // The evaluate method can provide quick code evaluation within the constructed
 * // shadowRealm without requiring any module loading, while it still requires CSP
 * // relaxing.
 * globalThis.someValue = 1;
 * red.evaluate('globalThis.someValue = 2'); // Affects only the ShadowRealm's global
 * console.assert(globalThis.someValue === 1);
 *
 * // The wrapped functions can also wrap other functions the other way around.
 * const setUniqueValue =
 * await red.importValue('./inside-code.js', 'setUniqueValue');
 *
 * // setUniqueValue = (cb) => (cb(globalThis.someValue) * 2);
 *
 * result = setUniqueValue((x) => x ** 3);
 *
 * console.assert(result === 16); // yields true
 * ```
 */
declare class ShadowRealm {
  /**
   * Creates a new [ShadowRealm](https://github.com/tc39/proposal-shadowrealm/blob/main/explainer.md#introduction)
   *
   * @example
   *
   * ```js
   * const red = new ShadowRealm();
   *
   * // realms can import modules that will execute within it's own environment.
   * // When the module is resolved, it captured the binding value, or creates a new
   * // wrapped function that is connected to the callable binding.
   * const redAdd = await red.importValue('./inside-code.js', 'add');
   *
   * // redAdd is a wrapped function exotic object that chains it's call to the
   * // respective imported binding.
   * let result = redAdd(2, 3);
   *
   * console.assert(result === 5); // yields true
   *
   * // The evaluate method can provide quick code evaluation within the constructed
   * // shadowRealm without requiring any module loading, while it still requires CSP
   * // relaxing.
   * globalThis.someValue = 1;
   * red.evaluate('globalThis.someValue = 2'); // Affects only the ShadowRealm's global
   * console.assert(globalThis.someValue === 1);
   *
   * // The wrapped functions can also wrap other functions the other way around.
   * const setUniqueValue =
   * await red.importValue('./inside-code.js', 'setUniqueValue');
   *
   * // setUniqueValue = (cb) => (cb(globalThis.someValue) * 2);
   *
   * result = setUniqueValue((x) => x ** 3);
   *
   * console.assert(result === 16); // yields true
   * ```
   */
  constructor();
  importValue(specifier: string, bindingName: string): Promise<any>;
  evaluate(sourceText: string): any;
}

interface Blob {
  /**
   * Read the contents of the [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) as a JSON object
   * @warn in browsers, this function is only available for `Response` and `Request`
   */
  json(): Promise<any>;
  /**
   * Read the [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) as a UTF-8 string
   * @link https://developer.mozilla.org/en-US/docs/Web/API/Blob/text
   */
  text(): Promise<string>;
  /**
   * Read the [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) as an ArrayBuffer object
   * @link https://developer.mozilla.org/en-US/docs/Web/API/Blob/arrayBuffer
   */
  arrayBuffer(): Promise<ArrayBuffer>;
}

declare var performance: {
  /**
   * Seconds since Bun.js started
   *
   * Uses a high-precision system timer to measure the time elapsed since the
   * Bun.js runtime was initialized. The value is represented as a double
   * precision floating point number. The value is monotonically increasing
   * during the lifetime of the runtime.
   *
   */
  now: () => number;
};

/**
 * Cancel a repeating timer by its timer ID.
 * @param id timer id
 */
declare function clearInterval(id?: number): void;
/**
 * Cancel a delayed function call by its timer ID.
 * @param id timer id
 */
declare function clearTimeout(id?: number): void;
// declare function createImageBitmap(image: ImageBitmapSource, options?: ImageBitmapOptions): Promise<ImageBitmap>;
// declare function createImageBitmap(image: ImageBitmapSource, sx: number, sy: number, sw: number, sh: number, options?: ImageBitmapOptions): Promise<ImageBitmap>;
/**
 * Send a HTTP(s) request
 *
 * @param url URL string
 * @param init A structured value that contains settings for the fetch() request.
 *
 * @returns A promise that resolves to {@link Response} object.
 *
 *
 */
declare function fetch(url: string, init?: RequestInit): Promise<Response>;

/**
 * Send a HTTP(s) request
 *
 * @param request Request object
 * @param init A structured value that contains settings for the fetch() request.
 *
 * @returns A promise that resolves to {@link Response} object.
 *
 *
 */
// tslint:disable-next-line:unified-signatures
declare function fetch(request: Request, init?: RequestInit): Promise<Response>;

declare function queueMicrotask(callback: () => void): void;
/**
 * Log an error using the default exception handler
 * @param error Error or string
 */
declare function reportError(error: any): void;
/**
 * Run a function every `interval` milliseconds
 * @param handler function to call
 * @param interval milliseconds to wait between calls
 */
declare function setInterval(
  handler: TimerHandler,
  interval?: number,
  ...arguments: any[]
): number;
/**
 * Run a function after `timeout` (milliseconds)
 * @param handler function to call
 * @param timeout milliseconds to wait between calls
 */
declare function setTimeout(
  handler: TimerHandler,
  timeout?: number,
  ...arguments: any[]
): number;
declare function addEventListener<K extends keyof EventMap>(
  type: K,
  listener: (this: object, ev: EventMap[K]) => any,
  options?: boolean | AddEventListenerOptions
): void;
declare function addEventListener(
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions
): void;
declare function removeEventListener<K extends keyof EventMap>(
  type: K,
  listener: (this: object, ev: EventMap[K]) => any,
  options?: boolean | EventListenerOptions
): void;
declare function removeEventListener(
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | EventListenerOptions
): void;

// -----------------------
// -----------------------
// --- libdom.d.ts

interface ErrorEventInit extends EventInit {
  colno?: number;
  error?: any;
  filename?: string;
  lineno?: number;
  message?: string;
}

interface EventInit {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
}

interface EventListenerOptions {
  capture?: boolean;
}

interface UIEventInit extends EventInit {
  detail?: number;
  view?: null;
  /** @deprecated */
  which?: number;
}

interface EventModifierInit extends UIEventInit {
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  modifierAltGraph?: boolean;
  modifierCapsLock?: boolean;
  modifierFn?: boolean;
  modifierFnLock?: boolean;
  modifierHyper?: boolean;
  modifierNumLock?: boolean;
  modifierScrollLock?: boolean;
  modifierSuper?: boolean;
  modifierSymbol?: boolean;
  modifierSymbolLock?: boolean;
  shiftKey?: boolean;
}

interface EventSourceInit {
  withCredentials?: boolean;
}

/** A controller object that allows you to abort one or more DOM requests as and when desired. */
interface AbortController {
  /**
   * Returns the AbortSignal object associated with this object.
   */
  readonly signal: AbortSignal;
  /**
   * Invoking this method will set this object's AbortSignal's aborted flag and signal to any observers that the associated activity is to be aborted.
   */
  abort(): void;
}

/** EventTarget is a DOM interface implemented by objects that can receive events and may have listeners for them. */
interface EventTarget {
  /**
   * Appends an event listener for events whose type attribute value is
   * type. The callback argument sets the callback that will be invoked
   * when the event is dispatched.
   *
   * The options argument sets listener-specific options. For
   * compatibility this can be a boolean, in which case the method behaves
   * exactly as if the value was specified as options's capture.
   *
   * When set to true, options's capture prevents callback from being
   * invoked when the event's eventPhase attribute value is
   * BUBBLING_PHASE. When false (or not present), callback will not be
   * invoked when event's eventPhase attribute value is CAPTURING_PHASE.
   * Either way,callback will be invoked if event's eventPhase attribute
   * value is AT_TARGET.
   *
   * When set to true, options's passive indicates that the callback will
   * not cancel the event by invoking preventDefault(). This is used to
   * enable performance optimizations described in § 2.8 Observing event
   * listeners.
   *
   * When set to true, options's once indicates that the callback will
   * only be invoked once after which the event listener will be removed.
   *
   * If an AbortSignal is passed for options's signal, then the event
   * listener will be removed when signal is aborted.
   *
   * The event listener is appended to target's event listener list and is
   * not appended if it has the same type, callback, and capture.
   */
  addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean
  ): void;
  /** Dispatches a synthetic event event to target and returns true if either event's cancelable attribute value is false or its preventDefault() method was not invoked, and false otherwise. */
  dispatchEvent(event: Event): boolean;
  /** Removes the event listener in target's event listener list with the same type, callback, and options. */
  removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean
  ): void;
}

declare var EventTarget: {
  prototype: EventTarget;
  new (): EventTarget;
};

/** An event which takes place in the DOM. */
interface Event {
  /**
   * Returns true or false depending on how event was initialized. True
   * if event goes through its target's ancestors in reverse tree order,
   * and false otherwise.
   */
  readonly bubbles: boolean;
  cancelBubble: boolean;
  /**
   * Returns true or false depending on how event was initialized. Its
   * return value does not always carry meaning, but true can indicate
   * that part of the operation during which event was dispatched, can be
   * canceled by invoking the preventDefault() method.
   */
  readonly cancelable: boolean;
  /**
   * Returns true or false depending on how event was initialized. True
   * if event invokes listeners past a ShadowRoot node that is the root of
   * its target, and false otherwise.
   */
  readonly composed: boolean;
  /**
   * Returns the object whose event listener's callback is currently
   * being invoked.
   */
  readonly currentTarget: EventTarget | null;
  /**
   * Returns true if preventDefault() was invoked successfully to
   * indicate cancelation, and false otherwise.
   */
  readonly defaultPrevented: boolean;
  /**
   * Returns the event's phase, which is one of NONE, CAPTURING_PHASE,
   * AT_TARGET, and BUBBLING_PHASE.
   */
  readonly eventPhase: number;
  /**
   * Returns true if event was dispatched by the user agent, and false
   * otherwise.
   */
  readonly isTrusted: boolean;
  /**
   * @deprecated
   */
  returnValue: boolean;
  /**
   * @deprecated
   */
  readonly srcElement: EventTarget | null;
  /**
   * Returns the object to which event is dispatched (its target).
   */
  readonly target: EventTarget | null;
  /**
   * Returns the event's timestamp as the number of milliseconds measured
   * relative to the time origin.
   */
  readonly timeStamp: DOMHighResTimeStamp;
  /**
   * Returns the type of event, e.g. "click", "hashchange", or "submit".
   */
  readonly type: string;
  /**
   * Returns the invocation target objects of event's path (objects on
   * which listeners will be invoked), except for any nodes in shadow
   * trees of which the shadow root's mode is "closed" that are not
   * reachable from event's currentTarget.
   */
  composedPath(): EventTarget[];
  /**
   * @deprecated
   */
  initEvent(type: string, bubbles?: boolean, cancelable?: boolean): void;
  /**
   * If invoked when the cancelable attribute value is true, and while
   * executing a listener for the event with passive set to false, signals
   * to the operation that caused event to be dispatched that it needs to
   * be canceled.
   */
  preventDefault(): void;
  /**
   * Invoking this method prevents event from reaching any registered
   * event listeners after the current one finishes running and, when
   * dispatched in a tree, also prevents event from reaching any other
   * objects.
   */
  stopImmediatePropagation(): void;
  /**
   * When dispatched in a tree, invoking this method prevents event from
   * reaching any objects other than the current object.
   */
  stopPropagation(): void;
  readonly AT_TARGET: number;
  readonly BUBBLING_PHASE: number;
  readonly CAPTURING_PHASE: number;
  readonly NONE: number;
}

declare var Event: {
  prototype: Event;
  new (type: string, eventInitDict?: EventInit): Event;
  readonly AT_TARGET: number;
  readonly BUBBLING_PHASE: number;
  readonly CAPTURING_PHASE: number;
  readonly NONE: number;
};

/**
 * Events providing information related to errors in scripts or in files.
 */
interface ErrorEvent extends Event {
  readonly colno: number;
  readonly error: any;
  readonly filename: string;
  readonly lineno: number;
  readonly message: string;
}

declare var ErrorEvent: {
  prototype: ErrorEvent;
  new (type: string, eventInitDict?: ErrorEventInit): ErrorEvent;
};

/**
 * The URL interface represents an object providing static methods used for
 * creating object URLs.
 */
interface URL {
  hash: string;
  host: string;
  hostname: string;
  href: string;
  toString(): string;
  readonly origin: string;
  password: string;
  pathname: string;
  port: string;
  protocol: string;
  search: string;
  readonly searchParams: URLSearchParams;
  username: string;
  toJSON(): string;
}

interface URLSearchParams {
  /** Appends a specified key/value pair as a new search parameter. */
  append(name: string, value: string): void;
  /** Deletes the given search parameter, and its associated value, from the list of all search parameters. */
  delete(name: string): void;
  /** Returns the first value associated to the given search parameter. */
  get(name: string): string | null;
  /** Returns all the values association with a given search parameter. */
  getAll(name: string): string[];
  /** Returns a Boolean indicating if such a search parameter exists. */
  has(name: string): boolean;
  /** Sets the value associated to a given search parameter to the given value. If there were several values, delete the others. */
  set(name: string, value: string): void;
  sort(): void;
  /** Returns a string containing a query string suitable for use in a URL. Does not include the question mark. */
  toString(): string;
  forEach(
    callbackfn: (value: string, key: string, parent: URLSearchParams) => void,
    thisArg?: any
  ): void;
}

declare var URLSearchParams: {
  prototype: URLSearchParams;
  new (
    init?: string[][] | Record<string, string> | string | URLSearchParams
  ): URLSearchParams;
  toString(): string;
};

declare var URL: {
  prototype: URL;
  new (url: string | URL, base?: string | URL): URL;
  /** Not implemented yet */
  createObjectURL(obj: Blob): string;
  /** Not implemented yet */
  revokeObjectURL(url: string): void;
};

type TimerHandler = (...args: any[]) => void;

interface EventListener {
  (evt: Event): void;
}

interface EventListenerObject {
  handleEvent(object: Event): void;
}

declare var AbortController: {
  prototype: AbortController;
  new (): AbortController;
};

interface FetchEvent extends Event {
  readonly request: Request;
  readonly url: string;

  waitUntil(promise: Promise<any>): void;
  respondWith(response: Response | Promise<Response>): void;
}

interface EventMap {
  fetch: FetchEvent;
  // exit: Event;
}

interface AbortSignalEventMap {
  abort: Event;
}

interface AddEventListenerOptions extends EventListenerOptions {
  once?: boolean;
  passive?: boolean;
  signal?: AbortSignal;
}

/** A signal object that allows you to communicate with a DOM request (such as a Fetch) and abort it if required via an AbortController object. */
interface AbortSignal extends EventTarget {
  /**
   * Returns true if this AbortSignal's AbortController has signaled to abort, and false otherwise.
   */
  readonly aborted: boolean;
  onabort: ((this: AbortSignal, ev: Event) => any) | null;
  addEventListener<K extends keyof AbortSignalEventMap>(
    type: K,
    listener: (this: AbortSignal, ev: AbortSignalEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener<K extends keyof AbortSignalEventMap>(
    type: K,
    listener: (this: AbortSignal, ev: AbortSignalEventMap[K]) => any,
    options?: boolean | EventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
}

declare var AbortSignal: {
  prototype: AbortSignal;
  new (): AbortSignal;
};

// type AlgorithmIdentifier = Algorithm | string;
// type BodyInit = ReadableStream | XMLHttpRequestBodyInit;
type BufferSource = ArrayBufferView | ArrayBuffer;
// type COSEAlgorithmIdentifier = number;
// type CSSNumberish = number;
// type CanvasImageSource =
//   | HTMLOrSVGImageElement
//   | HTMLVideoElement
//   | HTMLCanvasElement
//   | ImageBitmap;
type DOMHighResTimeStamp = number;
// type EpochTimeStamp = number;
type EventListenerOrEventListenerObject = EventListener | EventListenerObject;

/**
 * Low-level JavaScriptCore API for accessing the native ES Module loader (not a Bun API)
 *
 * Before using this, be aware of a few things:
 *
 * **Using this incorrectly will crash your application**.
 *
 * This API may change any time JavaScriptCore is updated.
 *
 * Bun may rewrite ESM import specifiers to point to bundled code. This will
 * be confusing when using this API, as it will return a string like
 * "/node_modules.server.bun".
 *
 * Bun may inject additional imports into your code. This usually has a `bun:` prefix.
 *
 */
declare var Loader: {
  /**
   * ESM module registry
   *
   * This lets you implement live reload in Bun. If you
   * delete a module specifier from this map, the next time it's imported, it
   * will be re-transpiled and loaded again.
   *
   * The keys are the module specifiers and the
   * values are metadata about the module.
   *
   * The keys are an implementation detail for Bun that will change between
   * versions.
   *
   * - Userland modules are an absolute file path
   * - Virtual modules have a `bun:` prefix or `node:` prefix
   * - JS polyfills start with `"/bun-vfs/"`. `"buffer"` is an example of a JS polyfill
   * - If you have a `node_modules.bun` file, many modules will point to that file
   *
   * Virtual modules and JS polyfills are embedded in bun's binary. They don't
   * point to anywhere in your local filesystem.
   *
   *
   */
  registry: Map<
    string,
    {
      /**
       * This refers to the state the ESM module is in
       *
       * TODO: make an enum for this number
       *
       *
       */
      state: number;
      dependencies: string[];
      /**
       * Your application will probably crash if you mess with this.
       */
      module: any;
    }
  >;
  /**
   * For an already-evaluated module, return the dependencies as module specifiers
   *
   * This list is already sorted and uniqued.
   *
   * @example
   *
   * For this code:
   * ```js
   * // /foo.js
   * import classNames from 'classnames';
   * import React from 'react';
   * import {createElement} from 'react';
   * ```
   *
   * This would return:
   * ```js
   * Loader.dependencyKeysIfEvaluated("/foo.js")
   * ["bun:wrap", "/path/to/node_modules/classnames/index.js", "/path/to/node_modules/react/index.js"]
   * ```
   *
   * @param specifier - module specifier as it appears in transpiled source code
   *
   */
  dependencyKeysIfEvaluated: (specifier: string) => string[];
  /**
   * The function JavaScriptCore internally calls when you use an import statement.
   *
   * This may return a path to `node_modules.server.bun`, which will be confusing.
   *
   * Consider {@link Bun.resolve} or {@link ImportMeta.resolve}
   * instead.
   *
   * @param specifier - module specifier as it appears in transpiled source code
   */
  resolve: (specifier: string) => Promise<string>;
  /**
   * Synchronously resolve a module specifier
   *
   * This may return a path to `node_modules.server.bun`, which will be confusing.
   *
   * Consider {@link Bun.resolveSync}
   * instead.
   */
  resolveSync: (specifier: string, from: string) => string;
};


// ./path.d.ts

/**
 * The `path` module provides utilities for working with file and directory paths.
 * It can be accessed using:
 *
 * ```js
 * import path  from 'path';
 * ```
 */
declare module "path/posix" {
  /**
   * A parsed path object generated by path.parse() or consumed by path.format().
   */
  interface ParsedPath {
    /**
     * The root of the path such as '/' or 'c:\'
     */
    root: string;
    /**
     * The full directory path such as '/home/user/dir' or 'c:\path\dir'
     */
    dir: string;
    /**
     * The file name including extension (if any) such as 'index.html'
     */
    base: string;
    /**
     * The file extension (if any) such as '.html'
     */
    ext: string;
    /**
     * The file name without extension (if any) such as 'index'
     */
    name: string;
  }
  interface FormatInputPathObject {
    /**
     * The root of the path such as '/' or 'c:\'
     */
    root?: string | undefined;
    /**
     * The full directory path such as '/home/user/dir' or 'c:\path\dir'
     */
    dir?: string | undefined;
    /**
     * The file name including extension (if any) such as 'index.html'
     */
    base?: string | undefined;
    /**
     * The file extension (if any) such as '.html'
     */
    ext?: string | undefined;
    /**
     * The file name without extension (if any) such as 'index'
     */
    name?: string | undefined;
  }

  /**
   * Normalize a string path, reducing '..' and '.' parts.
   * When multiple slashes are found, they're replaced by a single one; when the path contains a trailing slash, it is preserved. On Windows backslashes are used.
   *
   * @param p string path to normalize.
   */
  export function normalize(p: string): string;
  /**
   * Join all arguments together and normalize the resulting path.
   * Arguments must be strings. In v0.8, non-string arguments were silently ignored. In v0.10 and up, an exception is thrown.
   *
   * @param paths paths to join.
   */
  export function join(...paths: string[]): string;
  /**
   * The right-most parameter is considered {to}.  Other parameters are considered an array of {from}.
   *
   * Starting from leftmost {from} parameter, resolves {to} to an absolute path.
   *
   * If {to} isn't already absolute, {from} arguments are prepended in right to left order,
   * until an absolute path is found. If after using all {from} paths still no absolute path is found,
   * the current working directory is used as well. The resulting path is normalized,
   * and trailing slashes are removed unless the path gets resolved to the root directory.
   *
   * @param pathSegments string paths to join.  Non-string arguments are ignored.
   */
  export function resolve(...pathSegments: string[]): string;
  /**
   * Determines whether {path} is an absolute path. An absolute path will always resolve to the same location, regardless of the working directory.
   *
   * @param path path to test.
   */
  export function isAbsolute(p: string): boolean;
  /**
   * Solve the relative path from {from} to {to}.
   * At times we have two absolute paths, and we need to derive the relative path from one to the other. This is actually the reverse transform of path.resolve.
   */
  export function relative(from: string, to: string): string;
  /**
   * Return the directory name of a path. Similar to the Unix dirname command.
   *
   * @param p the path to evaluate.
   */
  export function dirname(p: string): string;
  /**
   * Return the last portion of a path. Similar to the Unix basename command.
   * Often used to extract the file name from a fully qualified path.
   *
   * @param p the path to evaluate.
   * @param ext optionally, an extension to remove from the result.
   */
  export function basename(p: string, ext?: string): string;
  /**
   * Return the extension of the path, from the last '.' to end of string in the last portion of the path.
   * If there is no '.' in the last portion of the path or the first character of it is '.', then it returns an empty string
   *
   * @param p the path to evaluate.
   */
  export function extname(p: string): string;
  /**
   * The platform-specific file separator. '\\' or '/'.
   */
  export var sep: string;
  /**
   * The platform-specific file delimiter. ';' or ':'.
   */
  export var delimiter: string;
  /**
   * Returns an object from a path string - the opposite of format().
   *
   * @param pathString path to evaluate.
   */
  export function parse(p: string): ParsedPath;
  /**
   * Returns a path string from an object - the opposite of parse().
   *
   * @param pathString path to evaluate.
   */
  export function format(pP: FormatInputPathObject): string;
  /**
   * On Windows systems only, returns an equivalent namespace-prefixed path for the given path.
   * If path is not a string, path will be returned without modifications.
   * This method is meaningful only on Windows system.
   * On POSIX systems, the method is non-operational and always returns path without modifications.
   */
  export function toNamespacedPath(path: string): string;
}

/**
 * The `path` module provides utilities for working with file and directory paths.
 * It can be accessed using:
 *
 * ```js
 * import path  from 'path';
 * ```
 */
declare module "path/win32" {
  export * from "path/posix";
}

/**
 * The `path` module provides utilities for working with file and directory paths.
 * It can be accessed using:
 *
 * ```js
 * import path  from 'path';
 * ```
 */
declare module "path" {
  export * from "path/posix";
  export * as posix from "path/posix";
  export * as win32 from "path/win32";
}

/**
 * The `path` module provides utilities for working with file and directory paths.
 * It can be accessed using:
 *
 * ```js
 * import path  from 'path';
 * ```
 */
declare module "node:path" {
  export * from "path";
}
/**
 * The `path` module provides utilities for working with file and directory paths.
 * It can be accessed using:
 *
 * ```js
 * import path  from 'path';
 * ```
 */
declare module "node:path/posix" {
  export * from "path/posix";
}
/**
 * The `path` module provides utilities for working with file and directory paths.
 * It can be accessed using:
 *
 * ```js
 * import path  from 'path';
 * ```
 */
declare module "node:path/win32" {
  export * from "path/win32";
}


// ./bun-test.d.ts

/**
 *
 * This isn't really designed for third-party usage yet.
 * You can try it if you want though!
 *
 * To run the tests, run `bun wiptest`
 *
 * @example
 *
 * ```bash
 * $ bun wiptest
 * ```
 *
 * @example
 * ```bash
 * $ bun wiptest file-name
 * ```
 */

declare module "bun:test" {
  export function describe(label: string, body: () => {}): any;
  export function it(label: string, test: () => void | Promise<any>): any;
  export function test(label: string, test: () => void | Promise<any>): any;

  export function expect(value: any): Expect;

  interface Expect {
    toBe(value: any): void;
    toContain(value: any): void;
  }
}

declare module "test" {
  import BunTestModule = require("bun:test");
  export = BunTestModule;
}

