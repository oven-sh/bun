[Elysia](https://elysiajs.com) is a Bun-first performance focused web framework that takes full advantage of Bun's HTTP, file system, and hot reloading APIs.
Designed with TypeScript in mind, you don't need to understand TypeScript to gain the benefit of TypeScript with Elysia. The library understands what you want and automatically infers the type from your code.

⚡️ Elysia is [one of the fastest Bun web frameworks](https://github.com/SaltyAom/bun-http-framework-benchmark)

```ts#server.ts
import { Elysia } from 'elysia'

const app = new Elysia()
	.get('/', () => 'Hello Elysia')
	.listen(8080)

console.log(`🦊 Elysia is running at on port ${app.server.port}...`)
```

Get started with `bun create`.

```bash
$ bun create elysia ./myapp
$ cd myapp
$ bun run dev
```

Refer to the Elysia [documentation](https://elysiajs.com/quick-start.html) for more information.
