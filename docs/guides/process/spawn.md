---
name: Spawn a child process
---

Use [`Bun.spawn()`](https://bun.sh/docs/api/spawn) to spawn a child process.

```ts
const proc = Bun.spawn(["echo", "hello"]);

// await completion
await proc.exited;
```

---

The second argument accepts a configuration object.

```ts
const proc = Bun.spawn(["echo", "Hello, world!"], {
  cwd: "/tmp",
  env: { FOO: "bar" },
  onExit(proc, exitCode, signalCode, error) {
    // exit handler
  },
});
```

---

By default, the `stdout` of the child process can be consumed as a `ReadableStream` using `proc.stdout`.

```ts
const proc = Bun.spawn(["echo", "hello"]);

const output = await new Response(proc.stdout).text();
output; // => "hello"
```

---

See [Docs > API > Child processes](https://bun.sh/docs/api/spawn) for complete documentation.
