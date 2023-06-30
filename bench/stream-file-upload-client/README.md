# HTTP request file upload benchmark

This is a simple benchmark of uploading a file to a web server in different runtimes.

## Usage

Generate a file to upload (default is `hello.txt`):

```bash
bun generate-file.js
```

Run the server:

```bash
node server-node.mjs
```

Run the benchmark in bun:

```bash
bun stream-file-bun.js
```

Run the benchmark in node:

```bash
node stream-file-node.mjs
```

Run the benchmark in deno:

```bash
deno run -A stream-file-deno.js
```
