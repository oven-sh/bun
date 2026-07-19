declare module "bun" {
  type ShellExpression =
    | { toString(): string }
    | Array<ShellExpression>
    | string
    | { raw: string }
    | Subprocess<SpawnOptions.Writable, SpawnOptions.Readable, SpawnOptions.Readable>
    | SpawnOptions.Readable
    | SpawnOptions.Writable
    | ReadableStream;

  /**
   * Runs a shell command with the [Bun Shell](https://bun.com/docs/runtime/shell).
   *
   * @example
   * ```ts
   * const result = await $`echo "Hello, world!"`.text();
   * console.log(result); // "Hello, world!"
   * ```
   *
   * @category Process Management
   */
  function $(strings: TemplateStringsArray, ...expressions: ShellExpression[]): $.ShellPromise;

  type $ = typeof $;

  namespace $ {
    /**
     * Perform bash-like brace expansion on the given pattern.
     * @param pattern Brace pattern to expand
     *
     * @example
     * ```js
     * const result = braces('index.{js,jsx,ts,tsx}');
     * console.log(result) // ['index.js', 'index.jsx', 'index.ts', 'index.tsx']
     * ```
     */
    function braces(pattern: string): string[];

    /**
     * Escape strings for input into shell commands.
     * @param input
     */
    function escape(input: string): string;

    /**
     * Change the default environment variables for shells created by this instance.
     *
     * @param newEnv Default environment variables to use for shells created by this instance
     * @default process.env
     *
     * @example
     * ```js
     * import {$} from 'bun';
     * $.env({ BUN: "bun" });
     * await $`echo $BUN`;
     * // "bun"
     * ```
     */
    function env(newEnv?: Record<string, string | undefined> | NodeJS.Dict<string> | undefined): $;

    /**
     * Change the default working directory for shells created by this instance.
     *
     * @param newCwd Default working directory to use for shells created by this instance
     */
    function cwd(newCwd?: string): $;

    /**
     * Configure the shell to not throw an exception on non-zero exit codes.
     */
    function nothrow(): $;

    /**
     * Configure whether the shell should throw an exception on non-zero exit codes.
     */
    function throws(shouldThrow: boolean): $;

    /**
     * **Experimental.** Create a sandboxed shell for running untrusted shell
     * commands. Policy is enforced inside Bun's shell interpreter, before any
     * command or filesystem operation executes:
     *
     * - Only Bun Shell builtins may run; external binaries are always
     *   blocked. `commands.allow` / `commands.deny` restrict the builtin set
     *   further.
     * - Filesystem access is denied unless a path's symlink-resolved form is
     *   under one of the `fs.read` / `fs.write` prefixes. A `write` prefix
     *   also grants read access; omit `write` for a read-only sandbox.
     * - The sandbox has no network access: no builtin performs network I/O
     *   and external binaries cannot run. `network` is reserved and only
     *   accepts `false`.
     * - `limits.timeout` / `limits.maxOutputBytes` stop runaway commands by
     *   rejecting the promise with a descriptive error.
     *
     * Blocked commands and file operations fail with exit code 1 and a
     * `"... not permitted in sandbox"` message on stderr, so `&&`/`||` and
     * `.nothrow()` compose normally.
     *
     * The returned shell inherits this shell's current `cwd`, `env`, and
     * `throws` settings. It cannot be re-sandboxed; derive a new sandbox from
     * an unsandboxed shell instead.
     *
     * @param options Sandbox policy. An empty object is the most restrictive
     * policy: all builtins, no filesystem access, no limits.
     *
     * @example
     * ```js
     * import { $ } from "bun";
     *
     * const box = $.sandbox({
     *   commands: { deny: ["rm"] },
     *   fs: { read: ["/workspace/data"], write: ["/workspace/data/out"] },
     *   limits: { timeout: 5_000, maxOutputBytes: 1024 * 1024 },
     * });
     *
     * await box`ls /workspace/data`; // ok
     * await box`cat /etc/passwd`;    // rejects: read access not permitted in sandbox
     * ```
     */
    function sandbox(options: ShellSandboxOptions): $;

    /**
     * Policy for a sandboxed shell created with `$.sandbox()`.
     */
    interface ShellSandboxOptions {
      /**
       * Which commands the sandboxed shell may run. External binaries are
       * always blocked; these lists filter Bun Shell's builtin commands.
       * Unknown command names throw.
       */
      commands?: {
        /**
         * If present, only these builtins may run.
         * @default all builtins
         */
        allow?: string[];
        /**
         * These builtins may never run, even when listed in `allow`.
         */
        deny?: string[];
      };
      /**
       * Filesystem path prefixes the sandboxed shell may touch. Paths must be
       * absolute. Every path a command, redirect, glob, or `[[ -f ... ]]`
       * test uses is resolved against the shell's cwd and through symlinks
       * before it is compared, so `..` segments and symlinks cannot escape.
       * @default no filesystem access
       */
      fs?: {
        /** Prefixes that may be read (listed, globbed, or used as input). */
        read?: string[];
        /** Prefixes that may be written. A write prefix also grants read. */
        write?: string[];
      };
      /**
       * Reserved. Sandboxed shells cannot access the network (external
       * binaries are blocked and no builtin performs network I/O), so the
       * only supported value is `false`.
       * @default false
       */
      network?: false;
      /** Resource limits for the whole script. */
      limits?: {
        /**
         * Wall-clock limit in milliseconds. When exceeded, the promise
         * rejects and the interpreter stops scheduling work.
         */
        timeout?: number;
        /**
         * Maximum total bytes the script may write to stdout, stderr, and
         * file redirects combined. When exceeded, the promise rejects.
         */
        maxOutputBytes?: number;
      };
    }

    /**
     * A shell command that runs once awaited, or once an output method like
     * `.text()` or `.json()` is called.
     *
     * @example
     * ```ts
     * const myShellPromise = $`echo "Hello, world!"`;
     * const result = await myShellPromise.text();
     * console.log(result); // "Hello, world!"
     * ```
     */
    class ShellPromise extends Promise<ShellOutput> {
      get stdin(): WritableStream;

      /**
       * Change the current working directory of the shell.
       * @param newCwd The new working directory
       */
      cwd(newCwd: string): this;

      /**
       * Set environment variables for the shell.
       * @param newEnv The new environment variables
       *
       * @example
       * ```ts
       * const { stdout } = await $`echo $FOO`.env({ ...process.env, FOO: "bun" });
       * console.log(stdout.toString()); // "bun\n"
       * ```
       */
      env(newEnv: Record<string, string | undefined> | NodeJS.Dict<string> | undefined): this;

      /**
       * By default, the shell writes to the current process's stdout and stderr while also buffering that output.
       *
       * `quiet()` configures the shell to only buffer the output.
       * @param isQuiet Whether to suppress output. Defaults to `true`
       */
      quiet(isQuiet?: boolean): this;

      /**
       * Read from stdout as a string, line by line
       *
       * Automatically calls {@link quiet} to disable echoing to stdout.
       */
      lines(): AsyncIterable<string>;

      /**
       * Read from stdout as a string.
       *
       * Automatically calls {@link quiet} to disable echoing to stdout.
       *
       * @param encoding The encoding to use when decoding the output
       * @returns A promise that resolves with stdout as a string
       *
       * @example
       * **Read as UTF-8 string**
       * ```ts
       * const output = await $`echo hello`.text();
       * console.log(output); // "hello\n"
       * ```
       *
       * **Read as base64 string**
       * ```ts
       * const output = await $`echo ${atob("hello")}`.text("base64");
       * console.log(output); // "hello\n"
       * ```
       */
      text(encoding?: BufferEncoding): Promise<string>;

      /**
       * Read from stdout as a JSON object
       *
       * Automatically calls {@link quiet}
       *
       * @returns A promise that resolves with stdout as a JSON object
       * @example
       *
       * ```ts
       * const output = await $`echo '{"hello": 123}'`.json();
       * console.log(output); // { hello: 123 }
       * ```
       *
       */
      json(): Promise<any>;

      /**
       * Read from stdout as an ArrayBuffer
       *
       * Automatically calls {@link quiet}
       * @returns A promise that resolves with stdout as an ArrayBuffer
       * @example
       *
       * ```ts
       * const output = await $`echo hello`.arrayBuffer();
       * console.log(output); // ArrayBuffer { byteLength: 6 }
       * ```
       */
      arrayBuffer(): Promise<ArrayBuffer>;

      /**
       * Read from stdout as a Blob
       *
       * Automatically calls {@link quiet}
       * @returns A promise that resolves with stdout as a Blob
       * @example
       * ```ts
       * const output = await $`echo hello`.blob();
       * console.log(output); // Blob { size: 6, type: "" }
       * ```
       */
      blob(): Promise<Blob>;

      /**
       * Configure the shell to not throw an exception on non-zero exit codes. Throwing can be re-enabled with `.throws(true)`.
       *
       * By default, the shell throws an exception on commands that return non-zero exit codes.
       */
      nothrow(): this;

      /**
       * Configure whether the shell should throw an exception on non-zero exit codes.
       *
       * By default, this is configured to `true`.
       */
      throws(shouldThrow: boolean): this;
    }

    /**
     * An error that occurred while executing a shell command with [the Bun Shell](https://bun.com/docs/runtime/shell).
     *
     * @example
     * ```ts
     * try {
     *   const result = await $`exit 1`;
     * } catch (error) {
     *   if (error instanceof $.ShellError) {
     *     console.log(error.exitCode); // 1
     *   }
     * }
     * ```
     */
    class ShellError extends Error implements ShellOutput {
      readonly stdout: Buffer;
      readonly stderr: Buffer;
      readonly exitCode: number;

      /**
       * Read from stdout as a string
       *
       * @param encoding The encoding to use when decoding the output
       * @returns Stdout as a string with the given encoding
       *
       * @example
       * **Read as UTF-8 string**
       * ```ts
       * const output = await $`echo hello`;
       * console.log(output.text()); // "hello\n"
       * ```
       *
       * **Read as base64 string**
       * ```ts
       * const output = await $`echo ${atob("hello")}`;
       * console.log(output.text("base64")); // "hello\n"
       * ```
       */
      text(encoding?: BufferEncoding): string;

      /**
       * Read from stdout as a JSON object
       *
       * @returns Stdout as a JSON object
       * @example
       *
       * ```ts
       * const output = await $`echo '{"hello": 123}'`;
       * console.log(output.json()); // { hello: 123 }
       * ```
       *
       */
      json(): any;

      /**
       * Read from stdout as an ArrayBuffer
       *
       * @returns Stdout as an ArrayBuffer
       * @example
       *
       * ```ts
       * const output = await $`echo hello`;
       * console.log(output.arrayBuffer()); // ArrayBuffer { byteLength: 6 }
       * ```
       */
      arrayBuffer(): ArrayBuffer;

      /**
       * Read from stdout as a Blob
       *
       * @returns Stdout as a blob
       * @example
       * ```ts
       * const output = await $`echo hello`;
       * console.log(output.blob()); // Blob { size: 6, type: "" }
       * ```
       */
      blob(): Blob;

      /**
       * Read from stdout as a Uint8Array
       *
       * @returns Stdout as a Uint8Array
       * @example
       * ```ts
       * const output = await $`echo hello`;
       * console.log(output.bytes()); // Uint8Array { byteLength: 6 }
       * ```
       */
      bytes(): Uint8Array<ArrayBuffer>;
    }

    interface ShellOutput {
      readonly stdout: Buffer;
      readonly stderr: Buffer;
      readonly exitCode: number;

      /**
       * Read from stdout as a string
       *
       * @param encoding The encoding to use when decoding the output
       * @returns Stdout as a string with the given encoding
       *
       * @example
       * **Read as UTF-8 string**
       * ```ts
       * const output = await $`echo hello`;
       * console.log(output.text()); // "hello\n"
       * ```
       *
       * **Read as base64 string**
       * ```ts
       * const output = await $`echo ${atob("hello")}`;
       * console.log(output.text("base64")); // "hello\n"
       * ```
       */
      text(encoding?: BufferEncoding): string;

      /**
       * Read from stdout as a JSON object
       *
       * @returns Stdout as a JSON object
       * @example
       *
       * ```ts
       * const output = await $`echo '{"hello": 123}'`;
       * console.log(output.json()); // { hello: 123 }
       * ```
       *
       */
      json(): any;

      /**
       * Read from stdout as an ArrayBuffer
       *
       * @returns Stdout as an ArrayBuffer
       * @example
       *
       * ```ts
       * const output = await $`echo hello`;
       * console.log(output.arrayBuffer()); // ArrayBuffer { byteLength: 6 }
       * ```
       */
      arrayBuffer(): ArrayBuffer;

      /**
       * Read from stdout as a Uint8Array
       *
       * @returns Stdout as a Uint8Array
       * @example
       *
       * ```ts
       * const output = await $`echo hello`;
       * console.log(output.bytes()); // Uint8Array { byteLength: 6 }
       * ```
       */
      bytes(): Uint8Array<ArrayBuffer>;

      /**
       * Read from stdout as a Blob
       *
       * @returns Stdout as a blob
       * @example
       * ```ts
       * const output = await $`echo hello`;
       * console.log(output.blob()); // Blob { size: 6, type: "" }
       * ```
       */
      blob(): Blob;
    }

    const Shell: new () => $;
  }
}
