---
name: Hot reload an HTTP server
---

Bun supports the [`--hot`](https://bun.sh/docs/runtime/hot#hot-mode) flag to run a file with hot reloading enabled. When any module or file changes, Bun re-runs the file.

```sh
bun --hot run index.ts
```

---

Bun detects when you are running an HTTP server with `Bun.serve()`. It reloads your fetch handler when source files change, _without_ restarting the `bun` process. This makes hot reloads nearly instantaneous.

```ts
Bun.serve({
  port: 3000,
  fetch(req) {
    return new Response(`Hello world`);
  },
});
```
