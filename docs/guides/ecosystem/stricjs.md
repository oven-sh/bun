---
name: Use StricJS
---

[StricJS](https://github.com/bunsvr) is a minimalist, fast web framework for Bun. Use `bun init` to create an empty project.

```bash
$ mkdir myapp
$ cd myapp
$ bun init
$ bun add @stricjs/router
```

---

To implement a simple HTTP server with StricJS:

```ts#index.ts
import { Router } from '@stricjs/router';

export default new Router()
  .get('/', () => new Response('Hi'));
```

---

To serve static files from `/public/*`:

```ts#index.ts
export default new Router()
  .get('/', () => new Response('Hi'))
  .get('/public/*', stream('.'));
```

---

Run the file in watch mode to start the development server.

```bash
$ bun --watch run index.ts
```

---

For more info, see Stric's [documentation](https://stricjs.gitbook.io/docs).
