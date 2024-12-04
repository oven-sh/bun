---
name: Read stdout from a child process
---

When using [`Bun.spawn()`](https://bun.sh/docs/api/spawn), the `stdout` of the child process can be consumed as a `ReadableStream` via `proc.stdout`.

```ts
const proc = Bun.spawn(["echo", "hello"]);

const output = await new Response(proc.stdout).text();
output; // => "hello"
```

---

To instead pipe the `stdout` of the child process to `stdout` of the parent process, set "inherit".

```ts
const proc = Bun.spawn(["echo", "hello"], {
  stdout: "inherit",
});
```

---

See [Docs > API > Child processes](https://bun.sh/docs/api/spawn) for complete documentation.
