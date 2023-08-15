---
name: Build an HTTP server using StricJS and Bun
---

[StricJS](https://github.com/bunsvr) is a Bun framework for building high-performance web applications and APIs.

- **Fast** — Stric is one of the fastest Bun frameworks. See [benchmark](https://github.com/bunsvr/benchmark) for more details.
- **Minimal** — The basic components like `@stricjs/router` and `@stricjs/utils` are under 50kB and require no external dependencies.
- **Extensible** — Stric includes with a plugin system, dependency injection, and optional optimizations for handling requests.

---

Use `bun init` to create an empty project.

```bash
$ mkdir myapp
$ cd myapp
$ bun init
$ bun add @stricjs/router @stricjs/utils
```

---

To implement a simple HTTP server with StricJS:

```ts#index.ts
import { Router } from '@stricjs/router';

export default new Router()
  .get('/', () => new Response('Hi'));
```

---

To serve static files from `/public`:

```ts#index.ts
import { dir } from '@stricjs/utils';

export default new Router()
  .get('/', () => new Response('Hi'))
  .get('/*', dir('./public'));
```

---

Run the file in watch mode to start the development server.

```bash
$ bun --watch run index.ts
```

---

For more info, see Stric's [documentation](https://stricjs.netlify.app).
