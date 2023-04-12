Spawn child processes with `Bun.spawn` or `Bun.spawnSync`.

## Spawn a process (`Bun.spawn()`)

Provide a command as an array of strings. The result of `Bun.spawn()` is a `Bun.Subprocess` object.

```ts
Bun.spawn(["echo", "hello"]);
```

The second argument to `Bun.spawn` is a parameters object that can be used to configure the subprocess.

```ts
const proc = Bun.spawn(["echo", "hello"], {
  cwd: "./path/to/subdir", // specify a working direcory
  env: { ...process.env, FOO: "bar" }, // specify environment variables
  onExit(proc, exitCode, signalCode, error) {
    // exit handler
  },
});

proc.pid; // process ID of subprocess
```

## Input stream

By default, the input stream of the subprocess is undefined; it can be configured with the `stdin` parameter.

```ts
const proc = Bun.spawn(["cat"], {
  stdin: await fetch("https://raw.githubusercontent.com/oven-sh/bun/main/examples/hashing.js"),
});

const text = await new Response(proc.stdout).text();
console.log(text); // "const input = "hello world".repeat(400); ..."
```

{% table %}

---

- `null`
- **Default.** Provide no input to the subprocess

---

- `"pipe"`
- Return a `FileSink` for fast incremental writing

---

- `"inherit"`
- Inherit the `stdin` of the parent process

---

- `Bun.file()`
- Read from the specified file.

---

- `TypedArray | DataView`
- Use a binary buffer as input.

---

- `Response`
- Use the response `body` as input.

---

- `Request`
- Use the request `body` as input.

---

- `number`
- Read from the file with a given file descriptor.

{% /table %}

The `"pipe"` option lets incrementally write to the subprocess's input stream from the parent process.

```ts
const proc = Bun.spawn(["cat"], {
  stdin: "pipe", // return a FileSink for writing
});

// enqueue string data
proc.stdin.write("hello");

// enqueue binary data
const enc = new TextEncoder();
proc.stdin.write(enc.encode(" world!"));

// send buffered data
proc.stdin.flush();

// close the input stream
proc.stdin.end();
```

## Output streams

You can read results from the subprocess via the `stdout` and `stderr` properties. By default these are instances of `ReadableStream`.

```ts
const proc = Bun.spawn(["echo", "hello"]);
const text = await new Response(proc.stdout).text();
console.log(text); // => "hello"
```

Configure the output stream by passing one of the following values to `stdout/stderr`:

{% table %}

---

- `"pipe"`
- **Default for `stdout`.** Pipe the output to a `ReadableStream` on the returned `Subprocess` object.

---

- `"inherit"`
- **Default for `stderr`.** Inherit from the parent process.

---

- `Bun.file()`
- Write to the specified file.

---

- `null`
- Write to `/dev/null`.

---

- `number`
- Write to the file with the given file descriptor.

{% /table %}

## Exit handling

Use the `onExit` callback to listen for the process exiting or being killed.

```ts
const proc = Bun.spawn(["echo", "hello"], {
  onExit(proc, exitCode, signalCode, error) {
    // exit handler
  },
});
```

For convenience, the `exited` property is a `Promise` that resolves when the process exits.

```ts
const proc = Bun.spawn(["echo", "hello"]);

await proc.exited; // resolves when process exit
proc.killed; // boolean — was the process killed?
proc.exitCode; // null | number
proc.signalCode; // null | "SIGABRT" | "SIGALRM" | ...
```

To kill a process:

```ts
const proc = Bun.spawn(["echo", "hello"]);
proc.kill();
proc.killed; // true

proc.kill(); // specify an exit code
```

The parent `bun` process will not terminate until all child processes have exited. Use `proc.unref()` to detach the child process from the parent.

```
const proc = Bun.spawn(["echo", "hello"]);
proc.unref();
```

## Blocking API (`Bun.spawnSync()`)

Bun provides a synchronous equivalent of `Bun.spawn` called `Bun.spawnSync`. This is a blocking API that supports the same inputs and parameters as `Bun.spawn`. It returns a `SyncSubprocess` object, which differs from `Subprocess` in a few ways.

1. It contains a `success` property that indicates whether the process exited with a zero exit code.
2. The `stdout` and `stderr` properties are instances of `Buffer` instead of `ReadableStream`.
3. There is no `stdin` property. Use `Bun.spawn` to incrementally write to the subprocess's input stream.

```ts
const proc = Bun.spawnSync(["echo", "hello"]);

console.log(proc.stdout.toString());
// => "hello\n"
```

As a rule of thumb, the asynchronous `Bun.spawn` API is better for HTTP servers and apps, and `Bun.spawnSync` is better for building command-line tools.

## Benchmarks

{%callout%}
⚡️ Under the hood, `Bun.spawn` and `Bun.spawnSync` use [`posix_spawn(3)`](https://man7.org/linux/man-pages/man3/posix_spawn.3.html).
{%/callout%}

Bun's `spawnSync` spawns processes 60% faster than the Node.js `child_process` module.

```bash
$ bun spawn.mjs
cpu: Apple M1 Max
runtime: bun 0.2.0 (arm64-darwin)

benchmark              time (avg)             (min … max)       p75       p99      p995
--------------------------------------------------------- -----------------------------
spawnSync echo hi  888.14 µs/iter    (821.83 µs … 1.2 ms) 905.92 µs      1 ms   1.03 ms
$ node spawn.node.mjs
cpu: Apple M1 Max
runtime: node v18.9.1 (arm64-darwin)

benchmark              time (avg)             (min … max)       p75       p99      p995
--------------------------------------------------------- -----------------------------
spawnSync echo hi    1.47 ms/iter     (1.14 ms … 2.64 ms)   1.57 ms   2.37 ms   2.52 ms
```

## Reference

A simple reference of the Spawn API and types are shown below. The real types have complex generics to strongly type the `Subprocess` streams with the options passed to `Bun.spawn` and `Bun.spawnSync`. For full details, find these types as defined [bun.d.ts](https://github.com/oven-sh/bun/blob/main/packages/bun-types/bun.d.ts).

```ts
interface Bun {
  spawn(command: string[], options?: SpawnOptions.OptionsObject): Subprocess;
  spawnSync(command: string[], options?: SpawnOptions.OptionsObject): SyncSubprocess;

  spawn(options: { cmd: string[] } & SpawnOptions.OptionsObject): Subprocess;
  spawnSync(options: { cmd: string[] } & SpawnOptions.OptionsObject): SyncSubprocess;
}

namespace SpawnOptions {
  interface OptionsObject {
    cwd?: string;
    env?: Record<string, string>;
    stdin?: SpawnOptions.Readable;
    stdout?: SpawnOptions.Writable;
    stderr?: SpawnOptions.Writable;
    onExit?: (proc: Subprocess, exitCode: number | null, signalCode: string | null, error: Error | null) => void;
  }

  type Readable =
    | "pipe"
    | "inherit"
    | "ignore"
    | null // equivalent to "ignore"
    | undefined // to use default
    | BunFile
    | ArrayBufferView
    | number;

  type Writable =
    | "pipe"
    | "inherit"
    | "ignore"
    | null // equivalent to "ignore"
    | undefined // to use default
    | BunFile
    | ArrayBufferView
    | number
    | ReadableStream
    | Blob
    | Response
    | Request;
}

interface Subprocess<Stdin, Stdout, Stderr> {
  readonly pid: number;
  // the exact stream types here are derived from the generic parameters
  readonly stdin: number | ReadableStream | FileSink | undefined;
  readonly stdout: number | ReadableStream | undefined;
  readonly stderr: number | ReadableStream | undefined;

  readonly exited: Promise<number>;

  readonly exitCode: number | undefined;
  readonly signalCode: Signal | null;
  readonly killed: boolean;

  ref(): void;
  unref(): void;
  kill(code?: number): void;
}

interface SyncSubprocess<Stdout, Stderr> {
  readonly pid: number;
  readonly success: boolean;
  // the exact buffer types here are derived from the generic parameters
  readonly stdout: Buffer | undefined;
  readonly stderr: Buffer | undefined;
}

type ReadableSubprocess = Subprocess<any, "pipe", "pipe">;
type WritableSubprocess = Subprocess<"pipe", any, any>;
type PipedSubprocess = Subprocess<"pipe", "pipe", "pipe">;
type NullSubprocess = Subprocess<null, null, null>;

type ReadableSyncSubprocess = SyncSubprocess<"pipe", "pipe">;
type NullSyncSubprocess = SyncSubprocess<null, null>;

type Signal =
  | "SIGABRT"
  | "SIGALRM"
  | "SIGBUS"
  | "SIGCHLD"
  | "SIGCONT"
  | "SIGFPE"
  | "SIGHUP"
  | "SIGILL"
  | "SIGINT"
  | "SIGIO"
  | "SIGIOT"
  | "SIGKILL"
  | "SIGPIPE"
  | "SIGPOLL"
  | "SIGPROF"
  | "SIGPWR"
  | "SIGQUIT"
  | "SIGSEGV"
  | "SIGSTKFLT"
  | "SIGSTOP"
  | "SIGSYS"
  | "SIGTERM"
  | "SIGTRAP"
  | "SIGTSTP"
  | "SIGTTIN"
  | "SIGTTOU"
  | "SIGUNUSED"
  | "SIGURG"
  | "SIGUSR1"
  | "SIGUSR2"
  | "SIGVTALRM"
  | "SIGWINCH"
  | "SIGXCPU"
  | "SIGXFSZ"
  | "SIGBREAK"
  | "SIGLOST"
  | "SIGINFO";
```
