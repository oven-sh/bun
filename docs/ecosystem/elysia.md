[Elysia](https://elysiajs.com) is a Bun-first web framework that takes full advantage of Bun's HTTP, file system, and hot reloading APIs.

```ts#server.ts
import { Elysia } from 'elysia'

const app = new Elysia()
	.get('/', () => 'Hello Elysia')
	.listen(8080)
	 
console.log(`🦊 Elysia is running at on port ${app.server.port}...`)
```

Get started with `bun create`.

```bash
$ bun create hono ./myapp
$ cd myapp
$ bun run dev
```

Refer to the Elysia [documentation](https://elysiajs.com/quick-start.html) for more information.