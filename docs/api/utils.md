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

Opens a file in your default editor. Bun auto-detects your editor via the `$VISUAL` or `$EDITOR` environment variables.

```ts
const currentFile = import.meta.url;
Bun.openInEditor(currentFile);
```

You can override this via the `debug.editor` setting in your [`bunfig.toml`](/docs/runtime/bunfig)

```toml-diff#bunfig.toml
+ [debug]
+ editor = "code"
```

Or specify an editor with the `editor` param. You can also specify a line and column number.

```ts
Bun.openInEditor(import.meta.url, {
  editor: "vscode", // or "subl"
  line: 10,
  column: 5,
});
```

Bun.ArrayBufferSink;

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

- `"` becomes `"&quot;"`
- `&` becomes `"&amp;"`
- `'` becomes `"&#x27;"`
- `<` becomes `"&lt;"`
- `>` becomes `"&gt;"`

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

buf; // => Uint8Array(25)
compressed; // => Uint8Array(10)
```

The second argument supports the same set of configuration options as [`Bun.gzipSync`](#bungzipsync).

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

## `Bun.nanoseconds()`

Returns the number of nanoseconds since the current `bun` process started, as a `number`. Useful for high-precision timing and benchmarking.

```ts
Bun.nanoseconds();
// => 7288958
```

## `Bun.readableStreamTo*()`

Bun implements a set of convenience functions for asynchronously consuming the body of a `ReadableStream` and converting it to various binary formats.

```ts
const stream = (await fetch("https://bun.sh")).body;
stream; // => ReadableStream

await Bun.readableStreamToArrayBuffer(stream);
// => ArrayBuffer

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

## `Bun.resolveSync()`

Resolves a file path or module specifier using Bun's internal module resolution algorithm. The first argument is the path to resolve, and the second argument is the "root". If no match is found, an `Error` is thrown.

```ts
Bun.resolveSync("./foo.ts", "/path/to/project");
// => "/path/to/project/foo.ts"

Bun.resolveSync("zod", "/path/to/project");
// => "/path/to/project/node_modules/zod/index.ts"
```

To resolve relative to the current working directory, pass `process.cwd` or `"."` as the root.

```ts
Bun.resolveSync("./foo.ts", process.cwd());
Bun.resolveSync("./foo.ts", "/path/to/project");
```

To resolve relative to the directory containing the current file, pass `import.meta.dir`.

```ts
Bun.resolveSync("./foo.ts", import.meta.dir);
```

## `serialize` & `deserialize` in `bun:jsc`

To save a JavaScript value into an ArrayBuffer & back, use `serialize` and `deserialize` from the `"bun:jsc"` module.

```js
import { serialize, deserialize } from "bun:jsc";

const buf = serialize({ foo: "bar" });
const obj = deserialize(buf);
console.log(obj); // => { foo: "bar" }
```

Internally, [`structuredClone`](https://developer.mozilla.org/en-US/docs/Web/API/structuredClone) and [`postMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage) serialize and deserialize the same way. This exposes the underlying [HTML Structured Clone Algorithm](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm) to JavaScript as an ArrayBuffer.
