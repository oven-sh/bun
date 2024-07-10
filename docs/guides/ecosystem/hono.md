---
name: Build an HTTP server using Hono and Bun
---

[Hono](https://github.com/honojs/hono) is a lightweight ultrafast web framework designed for the edge.

```ts
import { Hono } from "hono";
const app = new Hono();

app.get("/", c => c.text("Hono!"));

export default app;
```

---

Use `create-hono` to get started with one of Hono's project templates. Select `bun` when prompted for a template.

```bash
$ bun create hono myapp
✔ Which template do you want to use? › bun
cloned honojs/starter#main to /path/to/myapp
✔ Copied project files
$ cd myapp
$ bun install
```

---

Then start the dev server and visit [localhost:3000](http://localhost:3000).

```bash
$ bun run dev
```

---

Refer to Hono's guide on [getting started with Bun](https://hono.dev/getting-started/bun) for more information.
