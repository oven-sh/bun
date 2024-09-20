---
name: Read from stdin
---

For CLI tools, it's often useful to read from `stdin`. In Bun, the `console` object is an `AsyncIterable` that yields lines from `stdin`.

```ts#index.ts
const prompt = "Type something: ";
process.stdout.write(prompt);
for await (const line of console) {
  console.log(`You typed: ${line}`);
  process.stdout.write(prompt);
}
```

---

Running this file results in a never-ending interactive prompt that echoes whatever the user types.

```sh
$ bun run index.ts
Type something: hello
You typed: hello
Type something: hello again
You typed: hello again
```

---

Bun also exposes stdin as a `BunFile` via `Bun.stdin`. This is useful for incrementally reading large inputs that are piped into the `bun` process.

There is no guarantee that the chunks will be split line-by-line.

```ts#stdin.ts
for await (const chunk of Bun.stdin.stream()) {
  // chunk is Uint8Array
  // this converts it to text (assumes ASCII encoding)
  const chunkText = Buffer.from(chunk).toString();
  console.log(`Chunk: ${chunkText}`);
}
```

---

This will print the input that is piped into the `bun` process.

```sh
$ echo "hello" | bun run stdin.ts
Chunk: hello
```

---

See [Docs > API > Utils](https://bun.sh/docs/api/utils) for more useful utilities.
