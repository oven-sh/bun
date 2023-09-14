[Hono](https://github.com/honojs/hono) is a lightweight ultrafast web framework designed for the edge.

```ts
import { Hono } from "hono";
const app = new Hono();

app.get("/", c => c.text("Hono!"));

export default app;
```

Get started with `bun create` or follow Hono's [Bun quickstart](https://hono.dev/getting-started/bun).

```bash
$ bun create hono ./myapp
$ cd myapp
$ bun run start
```
