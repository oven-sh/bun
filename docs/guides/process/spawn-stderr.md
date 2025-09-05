---
name: Read stderr from a child process
---

When using [`Bun.spawn()`](https://bun.com/docs/api/spawn), the child process inherits the `stderr` of the spawning process. If instead you'd prefer to read and handle `stderr`, set the `stderr` option to `"pipe"`.

```ts
const proc = Bun.spawn(["echo", "hello"], {
  stderr: "pipe",
});
proc.stderr; // => ReadableStream
```

---

To read `stderr` until the child process exits, use .text()

```ts
const proc = Bun.spawn(["echo", "hello"], {
  stderr: "pipe",
});

const errors: string = await proc.stderr.text();
if (errors) {
  // handle errors
}
```

---

See [Docs > API > Child processes](https://bun.com/docs/api/spawn) for complete documentation.
