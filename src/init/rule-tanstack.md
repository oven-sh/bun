---
description: Use Bun with TanStack Start instead of Node.js, npm, pnpm, or vite.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## TanStack Start

This project uses TanStack Start, a full-stack React framework powered by Vite.

- Use `createServerFn` from `@tanstack/react-start` for server-side functions
- Use file-based routing in the `src/routes` directory
- Use `createFileRoute` from `@tanstack/react-router` to define routes
- Server functions run on the server and can access Bun APIs directly
- Use loaders for data fetching in routes

For more information, read the [TanStack Start documentation](https://tanstack.com/router/latest/docs/framework/react/start/introduction) and Bun API docs in `node_modules/bun-types/docs/**.md`.
