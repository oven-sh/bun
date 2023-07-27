---
name: Hot reload an HTTP server
---

Bun supports the [`--hot`](/docs/runtime/hot#hot-mode) flag to run a file with hot reloading enabled. When any module or file changes, Bun re-runs the file.

```sh
bun --hot run index.ts
```

---

To avoid re-running `Bun.serve()` during `--hot` reloads, you should assign the `Server` instance as a property of `globalThis`. The `globalThis` object survives hot reloads.

```ts
import { type Serve, type Server } from "bun";

// make TypeScript happy
declare global {
  var server: Server;
}

// define server parameters
const serveOptions: Serve = {
  port: 3000,
  fetch(req) {
    return new Response(`Hello world`);
  },
};

if (!globalThis.server) {
  globalThis.server = Bun.serve(serveOptions);
} else {
  globalThis.server.reload(serveOptions);
}
```

---

To avoid manually calling `server.reload()`, you can use start a server with Bun's [object syntax](/docs/runtime/hot#http-servers). If you `export default` a plain object with a `fetch` handler defined, then run this file with Bun, Bun will start an HTTP server as if you'd passed this object into `Bun.serve()`.

With this approach, Bun automatically reloads the server when reloads happen.

See [HTTP > Hot Reloading](<[/docs/api/http](https://bun.sh/docs/api/http#hot-reloading)>) for full docs.

```ts
import { type Serve } from "bun";

export default {
  port: 3000,
  fetch(req) {
    return new Response(`Hello world`);
  },
} satisfies Serve;
```
