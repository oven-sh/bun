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

## `Bun.stringWidth()`

```ts
Bun.stringWidth(input: string, options?: { countAnsiEscapeCodes?: boolean = false }): number
```

Returns the number of columns required to display a string. This is useful for aligning text in a terminal. By default, ANSI escape codes are removed before measuring the string. To include them, pass `{ countAnsiEscapeCodes: true }` as the second argument.

```ts
Bun.stringWidth("hello"); // => 5
Bun.stringWidth("\u001b[31mhello\u001b[0m"); // => 5
Bun.stringWidth("\u001b[31mhello\u001b[0m", { countAnsiEscapeCodes: true }); // => 12
```

Compared with the popular `string-width` npm package, `bun`'s implementation is > [100x faster](https://github.com/oven-sh/bun/blob/8abd1fb088bcf2e78bd5d0d65ba4526872d2ab61/bench/snippets/string-width.mjs#L22)



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
