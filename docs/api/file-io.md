{% callout %}
**Note** — The `Bun.file` and `Bun.write` APIs documented on this page are heavily optimized and represent the recommended way to perform file-system tasks using Bun. Existing Node.js projects may use Bun's [nearly complete](/docs/ecosystem/nodejs#node_fs) implementation of the [`node:fs`](https://nodejs.org/api/fs.html) module.
{% /callout %}

Bun provides a set of optimized APIs for reading and writing files.

## Reading files

`Bun.file(path): BunFile`

Create a `BunFile` instance with the `Bun.file(path)` function. A `BunFile` represents a lazily-loaded file; initializing it does not actually read the file from disk.

```ts
const foo = Bun.file("foo.txt"); // relative to cwd
foo.size; // number of bytes
foo.type; // MIME type
```

The reference conforms to the [`Blob`](https://developer.mozilla.org/en-US/docs/Web/API/Blob) interface, so the contents can be read in various formats.

```ts
const foo = Bun.file("foo.txt");

await foo.text(); // contents as a string
await foo.stream(); // contents as ReadableStream
await foo.arrayBuffer(); // contents as ArrayBuffer
```

File references can also be created using numerical [file descriptors](https://en.wikipedia.org/wiki/File_descriptor) or `file://` URLs.

```ts
Bun.file(1234);
Bun.file(new URL(import.meta.url)); // reference to the current file
```

A `BunFile` can point to a location on disk where a file does not exist.

```ts
const notreal = Bun.file("notreal.txt");
notreal.size; // 0
notreal.type; // "text/plain;charset=utf-8"
```

The default MIME type is `text/plain;charset=utf-8`, but it can be overridden by passing a second argument to `Bun.file`.

```ts
const notreal = Bun.file("notreal.json", { type: "application/json" });
notreal.type; // => "application/json;charset=utf-8"
```

For convenience, Bun exposes `stdin`, `stdout` and `stderr` as instances of `BunFile`.

```ts
Bun.stdin; // readonly
Bun.stdout;
Bun.stderr;
```

## Writing files

`Bun.write(destination, data): Promise<number>`

The `Bun.write` function is a multi-tool for writing payloads of all kinds to disk.

The first argument is the `destination` which can have any of the following types:

- `string`: A path to a location on the file system. Use the `"path"` module to manipulate paths.
- `URL`: A `file://` descriptor.
- `BunFile`: A file reference.

The second argument is the data to be written. It can be any of the following:

- `string`
- `Blob` (including `BunFile`)
- `ArrayBuffer` or `SharedArrayBuffer`
- `TypedArray` (`Uint8Array`, et. al.)
- `Response`

All possible permutations are handled using the fastest available system calls on the current platform.

{% details summary="See syscalls" %}

{% table %}

- Output
- Input
- System call
- Platform

---

- file
- file
- copy_file_range
- Linux

---

- file
- pipe
- sendfile
- Linux

---

- pipe
- pipe
- splice
- Linux

---

- terminal
- file
- sendfile
- Linux

---

- terminal
- terminal
- sendfile
- Linux

---

- socket
- file or pipe
- sendfile (if http, not https)
- Linux

---

- file (doesn't exist)
- file (path)
- clonefile
- macOS

---

- file (exists)
- file
- fcopyfile
- macOS

---

- file
- Blob or string
- write
- macOS

---

- file
- Blob or string
- write
- Linux

{% /table %}

{% /details %}

To write a string to disk:

```ts
const data = `It was the best of times, it was the worst of times.`;
await Bun.write("output.txt", data);
```

To copy a file to another location on disk:

```js
const input = Bun.file("input.txt");
const output = Bun.file("output.txt"); // doesn't exist yet!
await Bun.write(output, input);
```

To write a byte array to disk:

```ts
const encoder = new TextEncoder();
const data = encoder.encode("datadatadata"); // Uint8Array
await Bun.write("output.txt", data);
```

To write a file to `stdout`:

```ts
const input = Bun.file("input.txt");
await Bun.write(Bun.stdout, input);
```

To write an HTTP response to disk:

```ts
const response = await fetch("https://bun.sh");
await Bun.write("index.html", response);
```

## Benchmarks

The following is a 3-line implementation of the Linux `cat` command.

```ts#cat.ts
// Usage
// $ bun ./cat.ts ./path-to-file

import { resolve } from "path";

const path = resolve(process.argv.at(-1));
await Bun.write(Bun.stdout, Bun.file(path));
```

To run the file:

```bash
$ bun ./cat.ts ./path-to-file
```

It runs 2x faster than GNU `cat` for large files on Linux.

{% image src="/images/cat.jpg" /%}

## Reference

```ts
interface Bun {
  stdin: BunFile;
  stdout: BunFile;
  stderr: BunFile;

  file(path: string | number | URL, options?: { type?: string }): BunFile;

  write(
    destination: string | number | BunFile | URL,
    input: string | Blob | ArrayBuffer | SharedArrayBuffer | TypedArray | Response,
  ): Promise<number>;
}

interface BunFile {
  readonly size: number;
  readonly type: string;

  text(): Promise<string>;
  stream(): Promise<ReadableStream>;
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<any>;
}
```
