Bun Shell makes shell scripting with JavaScript & TypeScript fun. It's a cross-platform bash-like shell with seamless JavaScript interop.

{% callout type="note" %}
**Alpha-quality software**: Bun Shell is an unstable API still under development. If you have feature requests or run into bugs, please open an issue. There may be breaking changes in the future.
{% /callout %}

Quickstart:

```js
import { $ } from "bun";

const response = await fetch("https://example.com");

// Use Response as stdin.
await $`echo < ${response} > wc -c`; // 120
```

## Features:

- **Cross-platform**: works on Windows, Linux & macOS. Instead of `rimraf` or `cross-env`', you can use Bun Shell without installing extra dependencies. Common shell commands like `ls`, `cd`, `rm` are implemented natively.
- **Familiar**: Bun Shell is a bash-like shell, supporting redirection, pipes, environment variables and more.
- **Globs**: Glob patterns are supported natively, including `**`, `*`, `{expansion}`, and more.
- **Template literals**: Template literals are used to execute shell commands. This allows for easy interpolation of variables and expressions.
- **Safety**: Bun Shell escapes all strings by default, preventing shell injection attacks.
- **JavaScript interop**: Use `Response`, `ArrayBuffer`, `Blob`, `Bun.file(path)` and other JavaScript objects as stdin, stdout, and stderr.

## Getting started

The simplest shell command is `echo`. To run it, use the `$` template literal tag:

```js
import { $ } from "bun";

await $`echo "Hello World!"`; // Hello World!
```

By default, shell commands print to stdout. To quiet the output, call `.quiet()`:

```js
import { $ } from "bun";

await $`echo "Hello World!"`.quiet(); // No output
```

What if you want to access the output of the command as text? Use `.text()`:

```js
import { $ } from "bun";

// .text() automatically calls .quiet() for you
const welcome = await $`echo "Hello World!"`.text();

console.log(welcome); // Hello World!\n
```

To get stdout, stderr, and the exit code, use await or `.run`:

```js
import { $ } from "bun";

const { stdout, stderr, exitCode } = await $`echo "Hello World!"`.quiet();

console.log(stdout); // Buffer(6) [ 72, 101, 108, 108, 111, 32 ]
console.log(stderr); // Buffer(0) []
console.log(exitCode); // 0
```

## Redirection

Bun Shell supports redirection with `<`, `>`, and `|` operators.

### To JavaScript objects (`>`)

To redirect stdout to a JavaScript object, use the `>` operator:

```js
import { $ } from "bun";

const buffer = Buffer.alloc(100);
const result = await $`echo "Hello World!" > ${buffer}`;

console.log(result.exitCode); // 0
console.log(buffer.toString()); // Hello World!\n
```

The following JavaScript objects are supported for redirection to:

- `Buffer`, `Uint8Array`, `Uint16Array`, `Uint32Array`, `Int8Array`, `Int16Array`, `Int32Array`, `Float32Array`, `Float64Array`, `ArrayBuffer`, `SharedArrayBuffer` (writes to the underlying buffer)
- `Bun.file(path)`, `Bun.file(fd)` (writes to the file)

### From JavaScript objects (`<`)

To redirect the output from JavaScript objects to stdin, use the `<` operator:

```js
import { $, file } from "bun";

const response = new Response("hello i am a response body");

const result = await $`cat < ${response}`.text();

console.log(result); // hello i am a response body
```

The following JavaScript objects are supported for redirection from:

- `Buffer`, `Uint8Array`, `Uint16Array`, `Uint32Array`, `Int8Array`, `Int16Array`, `Int32Array`, `Float32Array`, `Float64Array`, `ArrayBuffer`, `SharedArrayBuffer` (reads from the underlying buffer)
- `Bun.file(path)`, `Bun.file(fd)` (reads from the file)
- `Response` (reads from the body)

### Piping (`|`)

Like in bash, you can pipe the output of one command to another:

```js
import { $ } from "bun";

const result = await $`echo "Hello World!" | wc -w`.text();

console.log(result); // 2\n
```

You can also pipe with JavaScript objects:

```js
import { $ } from "bun";

const response = new Response("hello i am a response body");

const result = await $`cat < ${response} | wc -w`.text();

console.log(result); // 6\n
```

## Environment variables

Environment variables can be set like in bash:

```js
import { $ } from "bun";

await $`FOO=foo bun -e 'console.log(process.env.FOO)'`; // foo\n
```

You can use string interpolation to set environment variables:

```js
import { $ } from "bun";

const foo = "bar123";

await $`FOO=${foo + "456"} bun -e 'console.log(process.env.FOO)'`; // bar123456\n
```

Input is escaped by default, preventing shell injection attacks:

```js
import { $ } from "bun";

const foo = "bar123; rm -rf /tmp";

await $`FOO=${foo} bun -e 'console.log(process.env.FOO)'`; // bar123; rm -rf /tmp\n
```

### Changing the environment variables

By default, `process.env` is used as the environment variables for all commands.

You can change the environment variables for a single command by calling `.env()`:

```js
import { $ } from "bun";

await $`echo $FOO`.env({ ...process.env, FOO: "bar" }); // bar
```

You can change the default environment variables for all commands by calling `$.env`:

```js
import { $ } from "bun";

$.env({ FOO: "bar" });

// the globally-set $FOO
await $`echo $FOO`; // bar

// the locally-set $FOO
await $`echo $FOO`.env({ FOO: "baz" }); // baz
```

You can reset the environment variables to the default by calling `$.env()` with no arguments:

```js
import { $ } from "bun";

$.env({ FOO: "bar" });

// the globally-set $FOO
await $`echo $FOO`; // bar

// the locally-set $FOO
await $`echo $FOO`.env(undefined); // ""
```

### Changing the working directory

You can change the working directory of a command by passing a string to `.cwd()`:

```js
import { $ } from "bun";

await $`pwd`.cwd("/tmp"); // /tmp
```

You can change the default working directory for all commands by calling `$.cwd`:

```js
import { $ } from "bun";

$.cwd("/tmp");

// the globally-set working directory
await $`pwd`; // /tmp

// the locally-set working directory
await $`pwd`.cwd("/"); // /
```

## Reading output

To read the output of a command as a string, use `.text()`:

```js
import { $ } from "bun";

const result = await $`echo "Hello World!"`.text();

console.log(result); // Hello World!\n
```

### Reading output as JSON

To read the output of a command as JSON, use `.json()`:

```js
import { $ } from "bun";

const result = await $`echo '{"foo": "bar"}'`.json();

console.log(result); // { foo: "bar" }
```

### Reading output line-by-line

To read the output of a command line-by-line, use `.lines()`:

```js
import { $ } from "bun";

for await (let line of $`echo "Hello World!"`.lines()) {
  console.log(line); // Hello World!
}
```

You can also use `.lines()` on a completed command:

```js
import { $ } from "bun";

const search = "bun";

for await (let line of await $`cat list.txt | grep ${search}`.lines()) {
  console.log(line);
}
```

### Reading output as a Blob

To read the output of a command as a Blob, use `.blob()`:

```js
import { $ } from "bun";

const result = await $`echo "Hello World!"`.blob();

console.log(result); // Blob(13) { size: 13, type: "text/plain" }
```

## Builtin Commands

For cross-platform compatibility, Bun Shell implements a set of builtin commands, in addition to reading commands from the PATH environment variable.

- `cd`: change the working directory
- `ls`: list files in a directory
- `rm`: remove files and directories
- `echo`: print text
- `pwd`: print the working directory
- `bun`: run bun in bun

**Partially** implemented:

- `mv`: move files and directories (missing cross-device support)

**Not** implemented yet, but planned:

- `mkdir`: create directories
- `cp`: copy files and directories
- `cat`: concatenate files

## Utilities

Bun Shell also implements a set of utilities for working with shells.

### `$.braces` (brace expansion)

This function implements simple [brace expansion](https://www.gnu.org/software/bash/manual/html_node/Brace-Expansion.html) for shell commands:

```js
import { $ } from "bun";

await $.braces(`echo {1,2,3}`);
// => ["echo 1", "echo 2", "echo 3"]
```

### `$.escape` (unescaped strings)

For security purposes, Bun Shell escapes input by default. If you need to disable that, this function returns a string that is not escaped by Bun Shell:

```js
import { $ } from "bun";

await $`echo ${$.escape("Hello World!")}`;
// => Hello World!
```

## .bun.sh file loader

For simple shell scripts, instead of `sh`, you can use Bun Shell to run shell scripts.

To do that, run any file with bun that ends with `.bun.sh`:

```sh
$ echo "echo Hello World!" > script.bun.sh
$ bun ./script.bun.sh
> Hello World!
```

On Windows, Bun Shell is used automatically to run `.sh` files when using Bun:

```sh
$ echo "echo Hello World!" > script.sh
# On windows, .bun.sh is not needed, just .sh
$ bun ./script.sh
> Hello World!
```

## Credits

Large parts of this API were inspired by [zx](https://github.com/google/zx), [dax](https://github.com/dsherret/dax), and [bnx](https://github.com/wobsoriano/bnx). Thank you to the authors of those projects.
