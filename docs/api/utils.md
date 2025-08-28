## `Bun.version`

A `string` containing the version of the `bun` CLI that is currently running.

```ts
Bun.version;
// => "0.6.4"
```

## `Bun.revision`

The git commit of [Bun](https://github.com/oven-sh/bun) that was compiled to create the current `bun` CLI.

```ts
Bun.revision;
// => "f02561530fda1ee9396f51c8bc99b38716e38296"
```

## `Bun.env`

An alias for `process.env`.

## `Bun.main`

An absolute path to the entrypoint of the current program (the file that was executed with `bun run`).

```ts#script.ts
Bun.main;
// /path/to/script.ts
```

This is particular useful for determining whether a script is being directly executed, as opposed to being imported by another script.

```ts
if (import.meta.path === Bun.main) {
  // this script is being directly executed
} else {
  // this file is being imported from another script
}
```

This is analogous to the [`require.main = module` trick](https://stackoverflow.com/questions/6398196/detect-if-called-through-require-or-directly-by-command-line) in Node.js.

## `Bun.sleep()`

`Bun.sleep(ms: number)`

Returns a `Promise` that resolves after the given number of milliseconds.

```ts
console.log("hello");
await Bun.sleep(1000);
console.log("hello one second later!");
```

Alternatively, pass a `Date` object to receive a `Promise` that resolves at that point in time.

```ts
const oneSecondInFuture = new Date(Date.now() + 1000);

console.log("hello");
await Bun.sleep(oneSecondInFuture);
console.log("hello one second later!");
```

## `Bun.sleepSync()`

`Bun.sleepSync(ms: number)`

A blocking synchronous version of `Bun.sleep`.

```ts
console.log("hello");
Bun.sleepSync(1000); // blocks thread for one second
console.log("hello one second later!");
```

## `Bun.which()`

`Bun.which(bin: string)`

Returns the path to an executable, similar to typing `which` in your terminal.

```ts
const ls = Bun.which("ls");
console.log(ls); // "/usr/bin/ls"
```

By default Bun looks at the current `PATH` environment variable to determine the path. To configure `PATH`:

```ts
const ls = Bun.which("ls", {
  PATH: "/usr/local/bin:/usr/bin:/bin",
});
console.log(ls); // "/usr/bin/ls"
```

Pass a `cwd` option to resolve for executable from within a specific directory.

```ts
const ls = Bun.which("ls", {
  cwd: "/tmp",
  PATH: "",
});

console.log(ls); // null
```

You can think of this as a builtin alternative to the [`which`](https://www.npmjs.com/package/which) npm package.

## `Bun.randomUUIDv7()`

`Bun.randomUUIDv7()` returns a [UUID v7](https://www.ietf.org/archive/id/draft-peabody-dispatch-new-uuid-format-01.html#name-uuidv7-layout-and-bit-order), which is monotonic and suitable for sorting and databases.

```ts
import { randomUUIDv7 } from "bun";

const id = randomUUIDv7();
// => "0192ce11-26d5-7dc3-9305-1426de888c5a"
```

A UUID v7 is a 128-bit value that encodes the current timestamp, a random value, and a counter. The timestamp is encoded using the lowest 48 bits, and the random value and counter are encoded using the remaining bits.

The `timestamp` parameter defaults to the current time in milliseconds. When the timestamp changes, the counter is reset to a pseudo-random integer wrapped to 4096. This counter is atomic and threadsafe, meaning that using `Bun.randomUUIDv7()` in many Workers within the same process running at the same timestamp will not have colliding counter values.

The final 8 bytes of the UUID are a cryptographically secure random value. It uses the same random number generator used by `crypto.randomUUID()` (which comes from BoringSSL, which in turn comes from the platform-specific system random number generator usually provided by the underlying hardware).

```ts
namespace Bun {
  function randomUUIDv7(
    encoding?: "hex" | "base64" | "base64url" = "hex",
    timestamp?: number = Date.now(),
  ): string;
  /**
   * If you pass "buffer", you get a 16-byte buffer instead of a string.
   */
  function randomUUIDv7(
    encoding: "buffer",
    timestamp?: number = Date.now(),
  ): Buffer;

  // If you only pass a timestamp, you get a hex string
  function randomUUIDv7(timestamp?: number = Date.now()): string;
}
```

You can optionally set encoding to `"buffer"` to get a 16-byte buffer instead of a string. This can sometimes avoid string conversion overhead.

```ts#buffer.ts
const buffer = Bun.randomUUIDv7("buffer");
```

`base64` and `base64url` encodings are also supported when you want a slightly shorter string.

```ts#base64.ts
const base64 = Bun.randomUUIDv7("base64");
const base64url = Bun.randomUUIDv7("base64url");
```

## `Bun.peek()`

`Bun.peek(prom: Promise)`

Reads a promise's result without `await` or `.then`, but only if the promise has already fulfilled or rejected.

```ts
import { peek } from "bun";

const promise = Promise.resolve("hi");

// no await!
const result = peek(promise);
console.log(result); // "hi"
```

This is important when attempting to reduce number of extraneous microticks in performance-sensitive code. It's an advanced API and you probably shouldn't use it unless you know what you're doing.

```ts
import { peek } from "bun";
import { expect, test } from "bun:test";

test("peek", () => {
  const promise = Promise.resolve(true);

  // no await necessary!
  expect(peek(promise)).toBe(true);

  // if we peek again, it returns the same value
  const again = peek(promise);
  expect(again).toBe(true);

  // if we peek a non-promise, it returns the value
  const value = peek(42);
  expect(value).toBe(42);

  // if we peek a pending promise, it returns the promise again
  const pending = new Promise(() => {});
  expect(peek(pending)).toBe(pending);

  // If we peek a rejected promise, it:
  // - returns the error
  // - does not mark the promise as handled
  const rejected = Promise.reject(
    new Error("Successfully tested promise rejection"),
  );
  expect(peek(rejected).message).toBe("Successfully tested promise rejection");
});
```

The `peek.status` function lets you read the status of a promise without resolving it.

```ts
import { peek } from "bun";
import { expect, test } from "bun:test";

test("peek.status", () => {
  const promise = Promise.resolve(true);
  expect(peek.status(promise)).toBe("fulfilled");

  const pending = new Promise(() => {});
  expect(peek.status(pending)).toBe("pending");

  const rejected = Promise.reject(new Error("oh nooo"));
  expect(peek.status(rejected)).toBe("rejected");
});
```

## `Bun.openInEditor()`

`Bun.openInEditor(file: string, options?: EditorOptions): void`
`Bun.openInEditor(file: string, line?: number, column?: number): void`

Opens a file in your configured editor at an optional line and column position. Bun auto-detects your editor via the `$VISUAL` or `$EDITOR` environment variables.

```ts
const currentFile = import.meta.url;
Bun.openInEditor(currentFile);

// Open at a specific line
Bun.openInEditor(currentFile, 42);

// Open at a specific line and column
Bun.openInEditor(currentFile, 42, 15);
```

You can override the default editor via the `debug.editor` setting in your [`bunfig.toml`](https://bun.com/docs/runtime/bunfig).

```toml-diff#bunfig.toml
+ [debug]
+ editor = "code"
```

Or specify an editor with the options object. You can also specify a line and column number.

```ts
Bun.openInEditor(import.meta.url, {
  editor: "vscode", // or "subl", "vim", "nano", etc.
  line: 10,
  column: 5,
});

// Useful for opening files from error stack traces
try {
  throw new Error("Something went wrong");
} catch (error) {
  const stack = error.stack;
  // Parse stack trace to get file, line, column...
  Bun.openInEditor("/path/to/file.ts", 25, 10);
}
```

Supported editors include VS Code (`code`, `vscode`), Sublime Text (`subl`), Vim (`vim`), Neovim (`nvim`), Emacs (`emacs`), and many others.

## `Bun.deepEquals()`

Recursively checks if two objects are equivalent. This is used internally by `expect().toEqual()` in `bun:test`.

```ts
const foo = { a: 1, b: 2, c: { d: 3 } };

// true
Bun.deepEquals(foo, { a: 1, b: 2, c: { d: 3 } });

// false
Bun.deepEquals(foo, { a: 1, b: 2, c: { d: 4 } });
```

A third boolean parameter can be used to enable "strict" mode. This is used by `expect().toStrictEqual()` in the test runner.

```ts
const a = { entries: [1, 2] };
const b = { entries: [1, 2], extra: undefined };

Bun.deepEquals(a, b); // => true
Bun.deepEquals(a, b, true); // => false
```

In strict mode, the following are considered unequal:

```ts
// undefined values
Bun.deepEquals({}, { a: undefined }, true); // false

// undefined in arrays
Bun.deepEquals(["asdf"], ["asdf", undefined], true); // false

// sparse arrays
Bun.deepEquals([, 1], [undefined, 1], true); // false

// object literals vs instances w/ same properties
class Foo {
  a = 1;
}
Bun.deepEquals(new Foo(), { a: 1 }, true); // false
```

## `Bun.escapeHTML()`

`Bun.escapeHTML(value: string | object | number | boolean): string`

Escapes the following characters from an input string:

- `"` becomes `&quot;`
- `&` becomes `&amp;`
- `'` becomes `&#x27;`
- `<` becomes `&lt;`
- `>` becomes `&gt;`

This function is optimized for large input. On an M1X, it processes 480 MB/s -
20 GB/s, depending on how much data is being escaped and whether there is non-ascii
text. Non-string types will be converted to a string before escaping.

## `Bun.stringWidth()` ~6,756x faster `string-width` alternative

Get the column count of a string as it would be displayed in a terminal.
Supports ANSI escape codes, emoji, and wide characters.

Example usage:

```ts
Bun.stringWidth("hello"); // => 5
Bun.stringWidth("\u001b[31mhello\u001b[0m"); // => 5
Bun.stringWidth("\u001b[31mhello\u001b[0m", { countAnsiEscapeCodes: true }); // => 12
```

This is useful for:

- Aligning text in a terminal
- Quickly checking if a string contains ANSI escape codes
- Measuring the width of a string in a terminal

This API is designed to match the popular "string-width" package, so that
existing code can be easily ported to Bun and vice versa.

[In this benchmark](https://github.com/oven-sh/bun/blob/5147c0ba7379d85d4d1ed0714b84d6544af917eb/bench/snippets/string-width.mjs#L13), `Bun.stringWidth` is a ~6,756x faster than the `string-width` npm package for input larger than about 500 characters. Big thanks to [sindresorhus](https://github.com/sindresorhus) for their work on `string-width`!

```ts
❯ bun string-width.mjs
cpu: 13th Gen Intel(R) Core(TM) i9-13900
runtime: bun 1.0.29 (x64-linux)

benchmark                                          time (avg)             (min … max)       p75       p99      p995
------------------------------------------------------------------------------------- -----------------------------
Bun.stringWidth     500 chars ascii              37.09 ns/iter   (36.77 ns … 41.11 ns)  37.07 ns  38.84 ns  38.99 ns

❯ node string-width.mjs

benchmark                                          time (avg)             (min … max)       p75       p99      p995
------------------------------------------------------------------------------------- -----------------------------
npm/string-width    500 chars ascii             249,710 ns/iter (239,970 ns … 293,180 ns) 250,930 ns  276,700 ns 281,450 ns
```

To make `Bun.stringWidth` fast, we've implemented it in Zig using optimized SIMD instructions, accounting for Latin1, UTF-16, and UTF-8 encodings. It passes `string-width`'s tests.

{% details summary="View full benchmark" %}

As a reminder, 1 nanosecond (ns) is 1 billionth of a second. Here's a quick reference for converting between units:

| Unit | 1 Millisecond |
| ---- | ------------- |
| ns   | 1,000,000     |
| µs   | 1,000         |
| ms   | 1             |

```js
❯ bun string-width.mjs
cpu: 13th Gen Intel(R) Core(TM) i9-13900
runtime: bun 1.0.29 (x64-linux)

benchmark                                          time (avg)             (min … max)       p75       p99      p995
------------------------------------------------------------------------------------- -----------------------------
Bun.stringWidth      5 chars ascii              16.45 ns/iter   (16.27 ns … 19.71 ns)  16.48 ns  16.93 ns  17.21 ns
Bun.stringWidth     50 chars ascii              19.42 ns/iter   (18.61 ns … 27.85 ns)  19.35 ns   21.7 ns  22.31 ns
Bun.stringWidth    500 chars ascii              37.09 ns/iter   (36.77 ns … 41.11 ns)  37.07 ns  38.84 ns  38.99 ns
Bun.stringWidth  5,000 chars ascii              216.9 ns/iter  (215.8 ns … 228.54 ns) 216.23 ns 228.52 ns 228.53 ns
Bun.stringWidth 25,000 chars ascii               1.01 µs/iter     (1.01 µs … 1.01 µs)   1.01 µs   1.01 µs   1.01 µs
Bun.stringWidth      7 chars ascii+emoji         54.2 ns/iter   (53.36 ns … 58.19 ns)  54.23 ns  57.55 ns  57.94 ns
Bun.stringWidth     70 chars ascii+emoji       354.26 ns/iter (350.51 ns … 363.96 ns) 355.93 ns 363.11 ns 363.96 ns
Bun.stringWidth    700 chars ascii+emoji          3.3 µs/iter      (3.27 µs … 3.4 µs)    3.3 µs    3.4 µs    3.4 µs
Bun.stringWidth  7,000 chars ascii+emoji        32.69 µs/iter   (32.22 µs … 45.27 µs)   32.7 µs  34.57 µs  34.68 µs
Bun.stringWidth 35,000 chars ascii+emoji       163.35 µs/iter (161.17 µs … 170.79 µs) 163.82 µs 169.66 µs 169.93 µs
Bun.stringWidth      8 chars ansi+emoji         66.15 ns/iter   (65.17 ns … 69.97 ns)  66.12 ns   69.8 ns  69.87 ns
Bun.stringWidth     80 chars ansi+emoji        492.95 ns/iter  (488.05 ns … 499.5 ns)  494.8 ns 498.58 ns  499.5 ns
Bun.stringWidth    800 chars ansi+emoji          4.73 µs/iter     (4.71 µs … 4.88 µs)   4.72 µs   4.88 µs   4.88 µs
Bun.stringWidth  8,000 chars ansi+emoji         47.02 µs/iter   (46.37 µs … 67.44 µs)  46.96 µs  49.57 µs  49.63 µs
Bun.stringWidth 40,000 chars ansi+emoji        234.45 µs/iter (231.78 µs … 240.98 µs) 234.92 µs 236.34 µs 236.62 µs
Bun.stringWidth     19 chars ansi+emoji+ascii  135.46 ns/iter (133.67 ns … 143.26 ns) 135.32 ns 142.55 ns 142.77 ns
Bun.stringWidth    190 chars ansi+emoji+ascii    1.17 µs/iter     (1.16 µs … 1.17 µs)   1.17 µs   1.17 µs   1.17 µs
Bun.stringWidth  1,900 chars ansi+emoji+ascii   11.45 µs/iter   (11.26 µs … 20.41 µs)  11.45 µs  12.08 µs  12.11 µs
Bun.stringWidth 19,000 chars ansi+emoji+ascii  114.06 µs/iter (112.86 µs … 120.06 µs) 114.25 µs 115.86 µs 116.15 µs
Bun.stringWidth 95,000 chars ansi+emoji+ascii  572.69 µs/iter (565.52 µs … 607.22 µs) 572.45 µs 604.86 µs 605.21 µs
```

```ts
❯ node string-width.mjs
cpu: 13th Gen Intel(R) Core(TM) i9-13900
runtime: node v21.4.0 (x64-linux)

benchmark                                           time (avg)             (min … max)       p75       p99      p995
-------------------------------------------------------------------------------------- -----------------------------
npm/string-width      5 chars ascii               3.19 µs/iter     (3.13 µs … 3.48 µs)   3.25 µs   3.48 µs   3.48 µs
npm/string-width     50 chars ascii              20.09 µs/iter  (18.93 µs … 435.06 µs)  19.49 µs  21.89 µs  22.59 µs
npm/string-width    500 chars ascii             249.71 µs/iter (239.97 µs … 293.18 µs) 250.93 µs  276.7 µs 281.45 µs
npm/string-width  5,000 chars ascii               6.69 ms/iter     (6.58 ms … 6.76 ms)   6.72 ms   6.76 ms   6.76 ms
npm/string-width 25,000 chars ascii             139.57 ms/iter (137.17 ms … 143.28 ms) 140.49 ms 143.28 ms 143.28 ms
npm/string-width      7 chars ascii+emoji          3.7 µs/iter     (3.62 µs … 3.94 µs)   3.73 µs   3.94 µs   3.94 µs
npm/string-width     70 chars ascii+emoji        23.93 µs/iter   (22.44 µs … 331.2 µs)  23.15 µs  25.98 µs   30.2 µs
npm/string-width    700 chars ascii+emoji       251.65 µs/iter (237.78 µs … 444.69 µs) 252.92 µs 325.89 µs 354.08 µs
npm/string-width  7,000 chars ascii+emoji         4.95 ms/iter     (4.82 ms … 5.19 ms)      5 ms   5.04 ms   5.19 ms
npm/string-width 35,000 chars ascii+emoji        96.93 ms/iter  (94.39 ms … 102.58 ms)  97.68 ms 102.58 ms 102.58 ms
npm/string-width      8 chars ansi+emoji          3.92 µs/iter     (3.45 µs … 4.57 µs)   4.09 µs   4.57 µs   4.57 µs
npm/string-width     80 chars ansi+emoji         24.46 µs/iter     (22.87 µs … 4.2 ms)  23.54 µs  25.89 µs  27.41 µs
npm/string-width    800 chars ansi+emoji        259.62 µs/iter (246.76 µs … 480.12 µs) 258.65 µs 349.84 µs 372.55 µs
npm/string-width  8,000 chars ansi+emoji          5.46 ms/iter     (5.41 ms … 5.57 ms)   5.48 ms   5.55 ms   5.57 ms
npm/string-width 40,000 chars ansi+emoji        108.91 ms/iter  (107.55 ms … 109.5 ms) 109.25 ms  109.5 ms  109.5 ms
npm/string-width     19 chars ansi+emoji+ascii    6.53 µs/iter     (6.35 µs … 6.75 µs)   6.54 µs   6.75 µs   6.75 µs
npm/string-width    190 chars ansi+emoji+ascii   55.52 µs/iter  (52.59 µs … 352.73 µs)  54.19 µs  80.77 µs 167.21 µs
npm/string-width  1,900 chars ansi+emoji+ascii  701.71 µs/iter (653.94 µs … 893.78 µs)  715.3 µs 855.37 µs  872.9 µs
npm/string-width 19,000 chars ansi+emoji+ascii   27.19 ms/iter   (26.89 ms … 27.41 ms)  27.28 ms  27.41 ms  27.41 ms
npm/string-width 95,000 chars ansi+emoji+ascii     3.68 s/iter        (3.66 s … 3.7 s)    3.69 s     3.7 s     3.7 s
```

{% /details %}

TypeScript definition:

```ts
namespace Bun {
  export function stringWidth(
    /**
     * The string to measure
     */
    input: string,
    options?: {
      /**
       * If `true`, count ANSI escape codes as part of the string width. If `false`, ANSI escape codes are ignored when calculating the string width.
       *
       * @default false
       */
      countAnsiEscapeCodes?: boolean;
      /**
       * When it's ambiugous and `true`, count emoji as 1 characters wide. If `false`, emoji are counted as 2 character wide.
       *
       * @default true
       */
      ambiguousIsNarrow?: boolean;
    },
  ): number;
}
```

<!-- ## `Bun.enableANSIColors()` -->

## `Bun.fileURLToPath()`

Converts a `file://` URL to an absolute path.

```ts
const path = Bun.fileURLToPath(new URL("file:///foo/bar.txt"));
console.log(path); // "/foo/bar.txt"
```

## `Bun.pathToFileURL()`

Converts an absolute path to a `file://` URL.

```ts
const url = Bun.pathToFileURL("/foo/bar.txt");
console.log(url); // "file:///foo/bar.txt"
```

<!-- Bun.hash; -->

## `Bun.gzipSync()`

Compresses a `Uint8Array` using zlib's GZIP algorithm.

```ts
const buf = Buffer.from("hello".repeat(100)); // Buffer extends Uint8Array
const compressed = Bun.gzipSync(buf);

buf; // => Uint8Array(500)
compressed; // => Uint8Array(30)
```

Optionally, pass a parameters object as the second argument:

{% details summary="zlib compression options"%}

```ts
export type ZlibCompressionOptions = {
  /**
   * The compression level to use. Must be between `-1` and `9`.
   * - A value of `-1` uses the default compression level (Currently `6`)
   * - A value of `0` gives no compression
   * - A value of `1` gives least compression, fastest speed
   * - A value of `9` gives best compression, slowest speed
   */
  level?: -1 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /**
   * How much memory should be allocated for the internal compression state.
   *
   * A value of `1` uses minimum memory but is slow and reduces compression ratio.
   *
   * A value of `9` uses maximum memory for optimal speed. The default is `8`.
   */
  memLevel?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /**
   * The base 2 logarithm of the window size (the size of the history buffer).
   *
   * Larger values of this parameter result in better compression at the expense of memory usage.
   *
   * The following value ranges are supported:
   * - `9..15`: The output will have a zlib header and footer (Deflate)
   * - `-9..-15`: The output will **not** have a zlib header or footer (Raw Deflate)
   * - `25..31` (16+`9..15`): The output will have a gzip header and footer (gzip)
   *
   * The gzip header will have no file name, no extra data, no comment, no modification time (set to zero) and no header CRC.
   */
  windowBits?:
    | -9
    | -10
    | -11
    | -12
    | -13
    | -14
    | -15
    | 9
    | 10
    | 11
    | 12
    | 13
    | 14
    | 15
    | 25
    | 26
    | 27
    | 28
    | 29
    | 30
    | 31;
  /**
   * Tunes the compression algorithm.
   *
   * - `Z_DEFAULT_STRATEGY`: For normal data **(Default)**
   * - `Z_FILTERED`: For data produced by a filter or predictor
   * - `Z_HUFFMAN_ONLY`: Force Huffman encoding only (no string match)
   * - `Z_RLE`: Limit match distances to one (run-length encoding)
   * - `Z_FIXED` prevents the use of dynamic Huffman codes
   *
   * `Z_RLE` is designed to be almost as fast as `Z_HUFFMAN_ONLY`, but give better compression for PNG image data.
   *
   * `Z_FILTERED` forces more Huffman coding and less string matching, it is
   * somewhat intermediate between `Z_DEFAULT_STRATEGY` and `Z_HUFFMAN_ONLY`.
   * Filtered data consists mostly of small values with a somewhat random distribution.
   */
  strategy?: number;
};
```

{% /details %}

## `Bun.gunzipSync()`

Decompresses a `Uint8Array` using zlib's GUNZIP algorithm.

```ts
const buf = Buffer.from("hello".repeat(100)); // Buffer extends Uint8Array
const compressed = Bun.gzipSync(buf);

const dec = new TextDecoder();
const uncompressed = Bun.gunzipSync(compressed);
dec.decode(uncompressed);
// => "hellohellohello..."
```

## `Bun.deflateSync()`

Compresses a `Uint8Array` using zlib's DEFLATE algorithm.

```ts
const buf = Buffer.from("hello".repeat(100));
const compressed = Bun.deflateSync(buf);

buf; // => Buffer(500)
compressed; // => Uint8Array(12)
```

The second argument supports the same set of configuration options as [`Bun.gzipSync`](#bun-gzipsync).

## `Bun.inflateSync()`

Decompresses a `Uint8Array` using zlib's INFLATE algorithm.

```ts
const buf = Buffer.from("hello".repeat(100));
const compressed = Bun.deflateSync(buf);

const dec = new TextDecoder();
const decompressed = Bun.inflateSync(compressed);
dec.decode(decompressed);
// => "hellohellohello..."
```

## `Bun.zstdCompressSync()`

Compresses a `Uint8Array`, `Buffer`, `ArrayBuffer`, or `string` using the [Zstandard](https://facebook.github.io/zstd/) compression algorithm.

```ts
const input = "hello world".repeat(100);
const compressed = Bun.zstdCompressSync(input);
// => Buffer

console.log(input.length);     // => 1100
console.log(compressed.length); // => 25 (significantly smaller!)
```

Zstandard provides excellent compression ratios with fast decompression speeds, making it ideal for applications where data is compressed once but decompressed frequently.

### Compression levels

Zstandard supports compression levels from `1` to `22`:

```ts
const data = "hello world".repeat(1000);

// Fast compression, larger output
const fast = Bun.zstdCompressSync(data, { level: 1 });

// Balanced compression (default is level 3)
const balanced = Bun.zstdCompressSync(data, { level: 3 });

// Maximum compression, slower but smallest output
const small = Bun.zstdCompressSync(data, { level: 22 });

console.log({ fast: fast.length, balanced: balanced.length, small: small.length });
// => { fast: 2776, balanced: 1064, small: 1049 }
```

The `level` parameter must be between 1 and 22. Higher levels provide better compression at the cost of slower compression speed.

```ts
// Invalid level throws an error
Bun.zstdCompressSync("data", { level: 0 }); // Error: Compression level must be between 1 and 22
```

## `Bun.zstdDecompressSync()`

Decompresses data that was compressed with Zstandard.

```ts
const input = "hello world".repeat(100);
const compressed = Bun.zstdCompressSync(input, { level: 6 });
const decompressed = Bun.zstdDecompressSync(compressed);

console.log(new TextDecoder().decode(decompressed));
// => "hello worldhello world..."
```

The function automatically detects the format and decompresses accordingly:

```ts
// Works with any input type that was compressed
const stringCompressed = Bun.zstdCompressSync("text data");
const bufferCompressed = Bun.zstdCompressSync(Buffer.from("binary data"));
const uint8Compressed = Bun.zstdCompressSync(new TextEncoder().encode("encoded data"));

console.log(new TextDecoder().decode(Bun.zstdDecompressSync(stringCompressed)));
console.log(new TextDecoder().decode(Bun.zstdDecompressSync(bufferCompressed)));
console.log(new TextDecoder().decode(Bun.zstdDecompressSync(uint8Compressed)));
```

## `Bun.zstdCompress()`

Asynchronously compresses data using Zstandard. This is useful for large data that might block the event loop if compressed synchronously.

```ts
const largeData = "large dataset ".repeat(100000);

// Won't block the event loop
const compressed = await Bun.zstdCompress(largeData, { level: 9 });
console.log(`Compressed ${largeData.length} bytes to ${compressed.length} bytes`);
```

The async version accepts the same compression levels and options as the sync version:

```ts
// Different compression levels
const level1 = await Bun.zstdCompress(data, { level: 1 });  // Fast
const level12 = await Bun.zstdCompress(data, { level: 12 }); // Balanced
const level22 = await Bun.zstdCompress(data, { level: 22 }); // Maximum compression
```

## `Bun.zstdDecompress()`

Asynchronously decompresses Zstandard-compressed data.

```ts
const data = "hello world ".repeat(10000);
const compressed = await Bun.zstdCompress(data, { level: 6 });
const decompressed = await Bun.zstdDecompress(compressed);

console.log(new TextDecoder().decode(decompressed) === data); // => true
```

Both async compression functions return `Promise<Buffer>`:

```ts
// Type annotations for clarity
const compressed: Promise<Buffer> = Bun.zstdCompress("data");
const decompressed: Promise<Buffer> = Bun.zstdDecompress(compressed);
```

## Zstandard performance characteristics

Zstandard offers excellent performance compared to other compression algorithms:

- **Compression ratio**: Generally better than gzip, competitive with brotli
- **Compression speed**: Faster than brotli, similar to gzip
- **Decompression speed**: Much faster than gzip and brotli
- **Memory usage**: Moderate, scales with compression level

{% details summary="Performance comparison example" %}

```ts
const testData = "The quick brown fox jumps over the lazy dog. ".repeat(10000);

// Zstandard
console.time("zstd compress");
const zstdCompressed = Bun.zstdCompressSync(testData, { level: 6 });
console.timeEnd("zstd compress");

console.time("zstd decompress");
Bun.zstdDecompressSync(zstdCompressed);
console.timeEnd("zstd decompress");

// Compare with gzip
console.time("gzip compress");
const gzipCompressed = Bun.gzipSync(testData);
console.timeEnd("gzip compress");

console.time("gzip decompress");
Bun.gunzipSync(gzipCompressed);
console.timeEnd("gzip decompress");

console.log({
  originalSize: testData.length,
  zstdSize: zstdCompressed.length,
  gzipSize: gzipCompressed.length,
  zstdRatio: (testData.length / zstdCompressed.length).toFixed(2) + "x",
  gzipRatio: (testData.length / gzipCompressed.length).toFixed(2) + "x",
});
```

{% /details %}

## Working with files

Compress and decompress files efficiently:

```ts
// Compress a file
const file = Bun.file("large-document.txt");
const content = await file.bytes();
const compressed = await Bun.zstdCompress(content, { level: 9 });
await Bun.write("large-document.txt.zst", compressed);

// Decompress a file
const compressedFile = Bun.file("large-document.txt.zst");
const compressedData = await compressedFile.bytes();
const decompressed = await Bun.zstdDecompress(compressedData);
await Bun.write("large-document-restored.txt", decompressed);
```

## HTTP compression with Zstandard

Modern browsers support Zstandard for HTTP compression. Check the `Accept-Encoding` header:

```ts
const server = Bun.serve({
  async fetch(req) {
    const acceptEncoding = req.headers.get("Accept-Encoding") || "";
    const responseData = "Large response content...".repeat(1000);
    
    if (acceptEncoding.includes("zstd")) {
      const compressed = await Bun.zstdCompress(responseData, { level: 6 });
      return new Response(compressed, {
        headers: {
          "Content-Encoding": "zstd",
          "Content-Type": "text/plain",
          "Content-Length": compressed.length.toString(),
        }
      });
    }
    
    // Fallback to uncompressed
    return new Response(responseData, {
      headers: { "Content-Type": "text/plain" }
    });
  },
  port: 3000,
});
```

## Error handling

All Zstandard functions will throw errors for invalid input:

```ts
try {
  // Invalid compression level
  Bun.zstdCompressSync("data", { level: 25 });
} catch (error) {
  console.error(error.message); // => "Compression level must be between 1 and 22"
}

try {
  // Invalid compressed data
  Bun.zstdDecompressSync("not compressed");
} catch (error) {
  console.error("Decompression failed"); // => Throws decompression error
}

// Async error handling
try {
  await Bun.zstdDecompress("invalid compressed data");
} catch (error) {
  console.error("Async decompression failed:", error.message);
}
```

---

For more detailed examples and performance comparisons, see [Compress and decompress data with Zstandard (zstd)](/docs/guides/util/zstd).

## `Bun.inspect()`

Serializes an object to a `string` exactly as it would be printed by `console.log`.

```ts
const obj = { foo: "bar" };
const str = Bun.inspect(obj);
// => '{\nfoo: "bar" \n}'

const arr = new Uint8Array([1, 2, 3]);
const str = Bun.inspect(arr);
// => "Uint8Array(3) [ 1, 2, 3 ]"
```

## `Bun.inspect.custom`

This is the symbol that Bun uses to implement `Bun.inspect`. You can override this to customize how your objects are printed. It is identical to `util.inspect.custom` in Node.js.

```ts
class Foo {
  [Bun.inspect.custom]() {
    return "foo";
  }
}

const foo = new Foo();
console.log(foo); // => "foo"
```

## `Bun.indexOfLine()`

`Bun.indexOfLine(buffer: Uint8Array | string, index: number): number`

Finds the line boundary (start of line) for a given byte or character index within a text buffer. This is useful for converting byte offsets to line/column positions for error reporting, syntax highlighting, or text editor features.

```ts
const text = "Hello\nWorld\nFrom\nBun";

// Find which line contains character at index 8
const lineStart = Bun.indexOfLine(text, 8);
console.log(lineStart); // => 6 (start of "World" line)

// The character at index 8 is 'r' in "World"
console.log(text[8]); // => 'r'
console.log(text.slice(lineStart, text.indexOf('\n', lineStart)));
// => "World"
```

This works with both strings and byte buffers:

```ts
const buffer = new TextEncoder().encode("Line 1\nLine 2\nLine 3");
const lineStart = Bun.indexOfLine(buffer, 10); // index 10 is in "Line 2"
console.log(lineStart); // => 7 (start of "Line 2")

// Convert back to string to verify
const decoder = new TextDecoder();
const lineEnd = buffer.indexOf(0x0a, lineStart); // 0x0a is '\n'
const line = decoder.decode(buffer.slice(lineStart, lineEnd === -1 ? undefined : lineEnd));
console.log(line); // => "Line 2"
```

Useful for building development tools like linters, formatters, or language servers:

```ts
function getLineAndColumn(text: string, index: number) {
  const lineStart = Bun.indexOfLine(text, index);
  const lineNumber = text.slice(0, lineStart).split('\n').length;
  const column = index - lineStart + 1;
  return { line: lineNumber, column };
}

const position = getLineAndColumn("Hello\nWorld\nFrom\nBun", 8);
console.log(position); // => { line: 2, column: 3 }
```

## `Bun.shellEscape()`

`Bun.shellEscape(input: string): string`

Escapes a string for safe use in shell commands by adding appropriate quoting and escaping special characters. This prevents shell injection vulnerabilities when constructing commands dynamically.

```ts
const userInput = "file with spaces & special chars.txt";
const escaped = Bun.shellEscape(userInput);
console.log(escaped); // => 'file with spaces & special chars.txt'

// Safe to use in shell commands
const command = `ls ${escaped}`;
console.log(command); // => ls 'file with spaces & special chars.txt'
```

It handles various special characters that have meaning in shells:

```ts
// Characters that need escaping
Bun.shellEscape("hello; rm -rf /"); // => 'hello; rm -rf /'
Bun.shellEscape("$HOME/file"); // => '$HOME/file'
Bun.shellEscape("`whoami`"); // => '`whoami`'
Bun.shellEscape("a\"quote\""); // => 'a"quote"'

// Already safe strings pass through unchanged
Bun.shellEscape("simple-filename.txt"); // => simple-filename.txt
```

Essential for safely constructing shell commands with user input:

```ts
function safeCopy(source: string, destination: string) {
  const safeSource = Bun.shellEscape(source);
  const safeDest = Bun.shellEscape(destination);
  
  // Now safe to execute
  const proc = Bun.spawn({
    cmd: ["sh", "-c", `cp ${safeSource} ${safeDest}`],
    stderr: "pipe"
  });
  
  return proc;
}

// This won't execute malicious commands
safeCopy("normal.txt", "evil; rm -rf /");
```

## `Bun.allocUnsafe()`

`Bun.allocUnsafe(size: number): Uint8Array`

Allocates a `Uint8Array` of the specified size without initializing the memory. This is faster than `new Uint8Array(size)` but the buffer contains arbitrary data from previously freed memory.

**⚠️ Warning**: The allocated memory is not zeroed and may contain sensitive data from previous allocations. Only use this when you'll immediately overwrite all bytes or when performance is critical and you understand the security implications.

```ts
// Faster allocation (but contains arbitrary data)
const buffer = Bun.allocUnsafe(1024);
console.log(buffer[0]); // => some random value (could be anything)

// Compare with safe allocation
const safeBuffer = new Uint8Array(1024);
console.log(safeBuffer[0]); // => 0 (always zeroed)
```

Best used when you'll immediately fill the entire buffer:

```ts
function readFileToBuffer(path: string): Uint8Array {
  const file = Bun.file(path);
  const size = file.size;
  
  // Safe to use allocUnsafe since we'll overwrite everything
  const buffer = Bun.allocUnsafe(size);
  
  // Fill the entire buffer with file data
  const bytes = file.bytes();
  buffer.set(bytes);
  
  return buffer;
}
```

Performance comparison:

```ts
// Benchmarking allocation methods
const size = 1024 * 1024; // 1MB

const start1 = Bun.nanoseconds();
const safe = new Uint8Array(size);
const safeTime = Bun.nanoseconds() - start1;

const start2 = Bun.nanoseconds();
const unsafe = Bun.allocUnsafe(size);
const unsafeTime = Bun.nanoseconds() - start2;

console.log(`Safe allocation: ${safeTime} ns`);
console.log(`Unsafe allocation: ${unsafeTime} ns`);
// Unsafe is typically 2-10x faster for large allocations
```

## `Bun.gc()`

`Bun.gc(force?: boolean): void`

Manually trigger JavaScript garbage collection. Useful for testing memory behavior or forcing cleanup at specific times.

```ts
// Request garbage collection
Bun.gc();

// Force synchronous garbage collection (blocking)
Bun.gc(true);
```

**Parameters:**
- `force` (`boolean`, optional): If `true`, runs garbage collection synchronously (blocking). Default is asynchronous.

**Note**: Manual garbage collection is generally not recommended in production applications. The JavaScript engine's automatic GC is typically more efficient.

## `Bun.generateHeapSnapshot()`

Generate detailed memory usage snapshots for debugging and profiling.

### JSC Format (Safari/Bun Inspector)

```ts
const snapshot = Bun.generateHeapSnapshot(); // defaults to "jsc"
const snapshot = Bun.generateHeapSnapshot("jsc");

// Use with `bun --inspect` or Safari Web Inspector
console.log(snapshot); // HeapSnapshot object
```

### V8 Format (Chrome DevTools)

```ts
const snapshot = Bun.generateHeapSnapshot("v8");

// Save to file for Chrome DevTools
await Bun.write("heap.heapsnapshot", snapshot);
```

**Formats:**
- `"jsc"` (default): Returns a `HeapSnapshot` object compatible with Safari Web Inspector and `bun --inspect`
- `"v8"`: Returns a JSON string compatible with Chrome DevTools

**Usage in development:**
1. Generate snapshot: `const snap = Bun.generateHeapSnapshot("v8")`
2. Save to file: `await Bun.write("memory.heapsnapshot", snap)`  
3. Open in Chrome DevTools > Memory tab > Load snapshot
4. Analyze memory usage, object references, and potential leaks

## `Bun.mmap()`

`Bun.mmap(path: string): Uint8Array`

Memory-maps a file, creating a `Uint8Array` that directly accesses the file's contents in memory without copying. This provides very fast access to large files and allows the operating system to manage memory efficiently.

```ts
// Map a large file into memory
const mapped = Bun.mmap("/path/to/large-file.bin");

// Access file contents directly
console.log(mapped.length); // File size in bytes
console.log(mapped[0]);     // First byte
console.log(mapped.slice(0, 100)); // First 100 bytes

// No explicit cleanup needed - GC will handle unmapping
```

Particularly efficient for large files:

```ts
// Reading a 1GB file with mmap vs traditional methods
const largeMapped = Bun.mmap("/path/to/1gb-file.bin");
// ↑ Very fast, no copying

const largeLoaded = await Bun.file("/path/to/1gb-file.bin").arrayBuffer();
// ↑ Slower, copies entire file into memory

// Both provide same data, but mmap is faster and uses less memory
console.log(largeMapped[1000] === new Uint8Array(largeLoaded)[1000]); // => true
```

Great for processing large data files:

```ts
function processLogFile(path: string) {
  const data = Bun.mmap(path);
  const decoder = new TextDecoder();
  
  let lineStart = 0;
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0x0a) { // newline
      const line = decoder.decode(data.slice(lineStart, i));
      processLine(line);
      lineStart = i + 1;
    }
  }
}

function processLine(line: string) {
  // Process each line...
}
```

**Important considerations:**
- The mapped memory is read-only
- Changes to the underlying file may or may not be reflected in the mapped data
- The mapping is automatically unmapped when the Uint8Array is garbage collected
- Very large files may hit system memory mapping limits


## `Bun.inspect.table(tabularData, properties, options)`

Format tabular data into a string. Like [`console.table`](https://developer.mozilla.org/en-US/docs/Web/API/console/table_static), except it returns a string rather than printing to the console.

```ts
console.log(
  Bun.inspect.table([
    { a: 1, b: 2, c: 3 },
    { a: 4, b: 5, c: 6 },
    { a: 7, b: 8, c: 9 },
  ]),
);
//
// ┌───┬───┬───┬───┐
// │   │ a │ b │ c │
// ├───┼───┼───┼───┤
// │ 0 │ 1 │ 2 │ 3 │
// │ 1 │ 4 │ 5 │ 6 │
// │ 2 │ 7 │ 8 │ 9 │
// └───┴───┴───┴───┘
```

Additionally, you can pass an array of property names to display only a subset of properties.

```ts
console.log(
  Bun.inspect.table(
    [
      { a: 1, b: 2, c: 3 },
      { a: 4, b: 5, c: 6 },
    ],
    ["a", "c"],
  ),
);
//
// ┌───┬───┬───┐
// │   │ a │ c │
// ├───┼───┼───┤
// │ 0 │ 1 │ 3 │
// │ 1 │ 4 │ 6 │
// └───┴───┴───┘
```

You can also conditionally enable ANSI colors by passing `{ colors: true }`.

```ts
console.log(
  Bun.inspect.table(
    [
      { a: 1, b: 2, c: 3 },
      { a: 4, b: 5, c: 6 },
    ],
    {
      colors: true,
    },
  ),
);
```

## `Bun.nanoseconds()`

`Bun.nanoseconds(): number`

Returns the number of nanoseconds since the Unix epoch (January 1, 1970 00:00:00 UTC), as a `number`. This provides the highest precision timing available and is useful for high-precision benchmarking and performance measurement.

```ts
const start = Bun.nanoseconds();
// ... some operation
const end = Bun.nanoseconds();
const elapsed = end - start;
console.log(`Operation took ${elapsed} nanoseconds`);
// => Operation took 1234567 nanoseconds

// Convert to milliseconds for easier reading
console.log(`Operation took ${elapsed / 1_000_000} milliseconds`);
// => Operation took 1.234567 milliseconds
```

This is significantly more precise than `Date.now()` which returns milliseconds, and `performance.now()` which returns milliseconds as floating point. Use this for micro-benchmarks where nanosecond precision is important.

```ts
// Comparing precision
Date.now();        // milliseconds (e.g. 1703123456789)
performance.now(); // milliseconds with sub-millisecond precision (e.g. 123.456)
Bun.nanoseconds(); // nanoseconds (e.g. 1703123456789123456)
```

## `Bun.readableStreamTo*()`

Bun implements a set of convenience functions for asynchronously consuming the body of a `ReadableStream` and converting it to various binary formats.

```ts
const stream = (await fetch("https://bun.com")).body;
stream; // => ReadableStream

await Bun.readableStreamToArrayBuffer(stream);
// => ArrayBuffer

await Bun.readableStreamToBytes(stream);
// => Uint8Array

await Bun.readableStreamToBlob(stream);
// => Blob

await Bun.readableStreamToJSON(stream);
// => object

await Bun.readableStreamToText(stream);
// => string

// returns all chunks as an array
await Bun.readableStreamToArray(stream);
// => unknown[]

// returns all chunks as a FormData object (encoded as x-www-form-urlencoded)
await Bun.readableStreamToFormData(stream);

// returns all chunks as a FormData object (encoded as multipart/form-data)
await Bun.readableStreamToFormData(stream, multipartFormBoundary);
```

## `Bun.resolve()` and `Bun.resolveSync()`

`Bun.resolve(specifier: string, from?: string): Promise<string>`
`Bun.resolveSync(specifier: string, from?: string): string`

Resolves module specifiers using Bun's internal module resolution algorithm. These functions implement the same resolution logic as `import` and `require()` statements, including support for package.json, node_modules traversal, and path mapping. If no match is found, an `Error` is thrown.

```ts
// Resolve relative paths
const resolved = Bun.resolveSync("./foo.ts", "/path/to/project");
console.log(resolved); // => "/path/to/project/foo.ts"

// Resolve npm packages
Bun.resolveSync("zod", "/path/to/project");
// => "/path/to/project/node_modules/zod/index.ts"

// Resolve Node.js built-ins (returns special node: URLs)
const fsPath = Bun.resolveSync("fs", "/path/to/project");
console.log(fsPath); // => "node:fs"
```

The async version allows for potential future enhancements (currently behaves the same):

```ts
const resolved = await Bun.resolve("./config.json", import.meta.dir);
console.log(resolved); // => "/absolute/path/to/config.json"
```

To resolve relative to the current working directory, pass `process.cwd()` or `"."` as the root.

```ts
Bun.resolveSync("./foo.ts", process.cwd());
Bun.resolveSync("./foo.ts", "/path/to/project");
```

To resolve relative to the directory containing the current file, pass `import.meta.dir`.

```ts
Bun.resolveSync("./foo.ts", import.meta.dir);
```

Useful for building tools that need to understand module resolution:

```ts
function findDependencies(entryPoint: string): string[] {
  const dependencies: string[] = [];
  const source = Bun.file(entryPoint).text();
  
  // Simple regex to find import statements (real implementation would use a parser)
  const imports = source.match(/import .* from ["']([^"']+)["']/g) || [];
  
  for (const importStmt of imports) {
    const specifier = importStmt.match(/from ["']([^"']+)["']/)?.[1];
    if (specifier) {
      try {
        const resolved = Bun.resolveSync(specifier, path.dirname(entryPoint));
        dependencies.push(resolved);
      } catch (error) {
        console.warn(`Could not resolve: ${specifier}`);
      }
    }
  }
  
  return dependencies;
}
```

Respects package.json configuration:

```ts
// If package.json has:
// {
//   "type": "module",
//   "exports": {
//     "./utils": "./dist/utils.js"
//   }
// }

const resolved = Bun.resolveSync("my-package/utils", "/project");
// => "/project/node_modules/my-package/dist/utils.js"
```

Error handling:

```ts
try {
  const resolved = Bun.resolveSync("nonexistent-package", "/project");
} catch (error) {
  console.error(`Module not found: ${error.message}`);
  // => Module not found: Cannot resolve "nonexistent-package" from "/project"
}
```

Both functions respect:
- `package.json` `exports` and `main` fields
- `node_modules` resolution algorithm
- TypeScript-style path mapping
- File extensions resolution (`.js`, `.ts`, `.tsx`, etc.)
- Directory index files (`index.js`, `index.ts`)

## `serialize` & `deserialize` in `bun:jsc`

To save a JavaScript value into an ArrayBuffer & back, use `serialize` and `deserialize` from the `"bun:jsc"` module.

```js
import { serialize, deserialize } from "bun:jsc";

const buf = serialize({ foo: "bar" });
const obj = deserialize(buf);
console.log(obj); // => { foo: "bar" }
```

Internally, [`structuredClone`](https://developer.mozilla.org/en-US/docs/Web/API/structuredClone) and [`postMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage) serialize and deserialize the same way. This exposes the underlying [HTML Structured Clone Algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm) to JavaScript as an ArrayBuffer.

## `Bun.stripANSI()` ~6-57x faster `strip-ansi` alternative

`Bun.stripANSI(text: string): string`

Strip ANSI escape codes from a string. This is useful for removing colors and formatting from terminal output.

```ts
const coloredText = "\u001b[31mHello\u001b[0m \u001b[32mWorld\u001b[0m";
const plainText = Bun.stripANSI(coloredText);
console.log(plainText); // => "Hello World"

// Works with various ANSI codes
const formatted = "\u001b[1m\u001b[4mBold and underlined\u001b[0m";
console.log(Bun.stripANSI(formatted)); // => "Bold and underlined"
```

`Bun.stripANSI` is significantly faster than the popular [`strip-ansi`](https://www.npmjs.com/package/strip-ansi) npm package:

```js
> bun bench/snippets/strip-ansi.mjs
cpu: Apple M3 Max
runtime: bun 1.2.21 (arm64-darwin)

benchmark                               avg (min … max) p75 / p99
------------------------------------------------------- ----------
Bun.stripANSI      11 chars no-ansi        8.13 ns/iter   8.27 ns
                                   (7.45 ns … 33.59 ns)  10.29 ns

Bun.stripANSI      13 chars ansi          51.68 ns/iter  52.51 ns
                                 (46.16 ns … 113.71 ns)  57.71 ns

Bun.stripANSI  16,384 chars long-no-ansi 298.39 ns/iter 305.44 ns
                                (281.50 ns … 331.65 ns) 320.70 ns

Bun.stripANSI 212,992 chars long-ansi    227.65 µs/iter 234.50 µs
                                (216.46 µs … 401.92 µs) 262.25 µs
```

```js
> node bench/snippets/strip-ansi.mjs
cpu: Apple M3 Max
runtime: node 24.6.0 (arm64-darwin)

benchmark                                avg (min … max) p75 / p99
-------------------------------------------------------- ---------
npm/strip-ansi      11 chars no-ansi      466.79 ns/iter 468.67 ns
                                 (454.08 ns … 570.67 ns) 543.67 ns

npm/strip-ansi      13 chars ansi         546.77 ns/iter 550.23 ns
                                 (532.74 ns … 651.08 ns) 590.35 ns

npm/strip-ansi  16,384 chars long-no-ansi   4.85 µs/iter   4.89 µs
                                     (4.71 µs … 5.00 µs)   4.98 µs

npm/strip-ansi 212,992 chars long-ansi      1.36 ms/iter   1.38 ms
                                     (1.27 ms … 1.73 ms)   1.49 ms

```

## `estimateShallowMemoryUsageOf` in `bun:jsc`

The `estimateShallowMemoryUsageOf` function returns a best-effort estimate of the memory usage of an object in bytes, excluding the memory usage of properties or other objects it references. For accurate per-object memory usage, use `Bun.generateHeapSnapshot`.

```js
import { estimateShallowMemoryUsageOf } from "bun:jsc";

const obj = { foo: "bar" };
const usage = estimateShallowMemoryUsageOf(obj);
console.log(usage); // => 16

const buffer = Buffer.alloc(1024 * 1024);
estimateShallowMemoryUsageOf(buffer);
// => 1048624

const req = new Request("https://bun.com");
estimateShallowMemoryUsageOf(req);
// => 167

const array = Array(1024).fill({ a: 1 });
// Arrays are usually not stored contiguously in memory, so this will not return a useful value (which isn't a bug).
estimateShallowMemoryUsageOf(array);
// => 16
```

## `Bun.unsafe` ⚠️

**⚠️ DANGER ZONE**: The `Bun.unsafe` namespace contains extremely dangerous low-level operations that can crash your application, corrupt memory, or leak sensitive data. Only use these APIs if you know exactly what you're doing and understand the risks.

### `Bun.unsafe.arrayBufferToString()`

Cast bytes to a `string` without copying. This is the fastest way to get a `String` from a `Uint8Array` or `ArrayBuffer`.

```ts
const bytes = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
const str = Bun.unsafe.arrayBufferToString(bytes);
console.log(str); // => "hello"
```

**⚠️ Critical warnings:**
- **Only use this for ASCII strings**. Non-ASCII characters may crash your application or cause confusing bugs like `"foo" !== "foo"`
- **The input buffer must not be garbage collected**. Hold a reference to the buffer for the string's entire lifetime
- **Memory corruption risk**: Incorrect usage can lead to security vulnerabilities

### `Bun.unsafe.gcAggressionLevel()`

Force the garbage collector to run extremely often, especially useful for debugging memory issues in tests.

```ts
// Get current level
const currentLevel = Bun.unsafe.gcAggressionLevel();

// Set aggressive GC for debugging
const previousLevel = Bun.unsafe.gcAggressionLevel(2);

// Later, restore original level
Bun.unsafe.gcAggressionLevel(previousLevel);
```

**Levels:**
- `0`: Default, disabled
- `1`: Asynchronously call GC more often  
- `2`: Synchronously call GC more often (most aggressive)

**Environment variable**: `BUN_GARBAGE_COLLECTOR_LEVEL` is also supported.

### `Bun.unsafe.mimallocDump()`

Dump the mimalloc heap to the console for debugging memory usage. Only available on macOS.

```ts
// Dump heap statistics to console
Bun.unsafe.mimallocDump();
```

### `Bun.unsafe.segfault()` ☠️

**☠️ EXTREMELY DANGEROUS**: Immediately crashes the process with a segmentation fault. Only used for testing crash handlers.

```ts
// This will immediately crash your program
Bun.unsafe.segfault(); // Process terminates with segfault
```

**Never use this in production code.**

## `Bun.CSRF`

A utility namespace for generating and verifying CSRF (Cross-Site Request Forgery) tokens. CSRF tokens help protect web applications against CSRF attacks by ensuring that state-changing requests originate from the same site that served the form.

### `Bun.CSRF.generate(secret?, options?)`

Generates a CSRF token using the specified secret and options.

```ts
import { CSRF } from "bun";

// Generate with default secret
const token = CSRF.generate();
console.log(token); // => "base64url-encoded-token"

// Generate with custom secret
const tokenWithSecret = CSRF.generate("my-secret-key");
console.log(tokenWithSecret); // => "base64url-encoded-token"

// Generate with options
const customToken = CSRF.generate("my-secret", {
  encoding: "hex",
  expiresIn: 60 * 60 * 1000, // 1 hour in milliseconds
  algorithm: "sha256"
});
```

**Parameters:**
- `secret` (`string`, optional): Secret key for token generation. If not provided, uses a default internal secret
- `options` (`CSRFGenerateOptions`, optional): Configuration options

**Options:**
- `encoding` (`"base64url" | "base64" | "hex"`): Output encoding format (default: `"base64url"`)
- `expiresIn` (`number`): Token expiration time in milliseconds (default: 24 hours)
- `algorithm` (`CSRFAlgorithm`): Hash algorithm to use (default: `"sha256"`)

**Supported algorithms:**
- `"blake2b256"` - BLAKE2b with 256-bit output
- `"blake2b512"` - BLAKE2b with 512-bit output  
- `"sha256"` - SHA-256 (default)
- `"sha384"` - SHA-384
- `"sha512"` - SHA-512
- `"sha512-256"` - SHA-512/256

**Returns:** `string` - The generated CSRF token

### `Bun.CSRF.verify(token, options?)`

Verifies a CSRF token against the specified secret and constraints.

```ts
import { CSRF } from "bun";

const secret = "my-secret-key";
const token = CSRF.generate(secret);

// Verify with same secret
const isValid = CSRF.verify(token, { secret });
console.log(isValid); // => true

// Verify with wrong secret
const isInvalid = CSRF.verify(token, { secret: "wrong-secret" });
console.log(isInvalid); // => false

// Verify with maxAge constraint
const isExpired = CSRF.verify(token, { 
  secret, 
  maxAge: 1000 // 1 second
});
// If more than 1 second has passed, this will return false
```

**Parameters:**
- `token` (`string`): The CSRF token to verify
- `options` (`CSRFVerifyOptions`, optional): Verification options

**Options:**
- `secret` (`string`, optional): Secret key used for verification. If not provided, uses the default internal secret
- `encoding` (`"base64url" | "base64" | "hex"`): Token encoding format (default: `"base64url"`)
- `maxAge` (`number`, optional): Maximum age in milliseconds. If specified, tokens older than this will be rejected
- `algorithm` (`CSRFAlgorithm`): Hash algorithm used (must match the one used for generation)

**Returns:** `boolean` - `true` if the token is valid, `false` otherwise

### Security considerations

- **Secret management**: Use a cryptographically secure, randomly generated secret that's unique to your application
- **Token lifetime**: Set appropriate expiration times - shorter is more secure but may affect user experience
- **Transport security**: Always transmit CSRF tokens over HTTPS in production
- **Storage**: Store tokens securely (e.g., in HTTP-only cookies or secure session storage)

### Example: Express.js integration

```ts
import { CSRF } from "bun";
import express from "express";

const app = express();
const secret = process.env.CSRF_SECRET || "your-secret-key";

// Middleware to add CSRF token to forms
app.use((req, res, next) => {
  if (req.method === "GET") {
    res.locals.csrfToken = CSRF.generate(secret);
  }
  next();
});

// Middleware to verify CSRF token
app.use((req, res, next) => {
  if (["POST", "PUT", "DELETE", "PATCH"].includes(req.method)) {
    const token = req.body._csrf || req.headers["x-csrf-token"];
    
    if (!token || !CSRF.verify(token, { secret })) {
      return res.status(403).json({ error: "Invalid CSRF token" });
    }
  }
  next();
});

// Route that requires CSRF protection
app.post("/api/data", (req, res) => {
  // This route is now protected against CSRF attacks
  res.json({ message: "Data updated successfully" });
});
```

### Example: HTML form integration

```html
<!-- In your HTML template -->
<form method="POST" action="/submit">
  <input type="hidden" name="_csrf" value="${csrfToken}">
  <input type="text" name="data" required>
  <button type="submit">Submit</button>
</form>
```

### Error handling

```ts
import { CSRF } from "bun";

try {
  // Generate token
  const token = CSRF.generate("my-secret");
  
  // Verify token
  const isValid = CSRF.verify(token, { secret: "my-secret" });
} catch (error) {
  if (error.message.includes("secret")) {
    console.error("Invalid secret provided");
  } else {
    console.error("CSRF operation failed:", error.message);
  }
}
```

Common error scenarios:
- Empty or invalid token strings throw verification errors
- Empty secret strings throw generation/verification errors
- Invalid encoding options are handled gracefully
- Malformed tokens return `false` rather than throwing
