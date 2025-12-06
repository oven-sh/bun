---
description: Use Bun with Next.js - Server Actions, RSC, and Bun APIs.
globs: "*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json"
alwaysApply: false
---

Default to using Bun instead of Node.js with Next.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Bun automatically loads .env, so don't use dotenv.
- Use `bun --bun next dev` to run Next.js development server with Bun

## Next.js with Bun

This is a Next.js project running on Bun. Next.js handles routing, server components, and API routes.

### Server Actions & Server Components

Use Next.js Server Actions and React Server Components (RSC) for server-side logic:

```tsx#app/actions.ts
"use server"

export async function myServerAction(formData: FormData) {
  // Server-side code runs on Bun
  const data = await Bun.file("data.json").json();
  return { success: true, data };
}
```

```tsx#app/page.tsx
import { myServerAction } from "./actions";

export default async function Page() {
  // Server Component - runs on Bun
  const data = await Bun.file("data.json").json();

  return (
    <form action={myServerAction}>
      {/* Client Component form */}
    </form>
  );
}
```

### Using Bun APIs in Next.js

You can use Bun APIs in Server Actions, Server Components, API Routes, and Route Handlers:

```tsx#app/api/users/route.ts
import { NextResponse } from "next/server";

export async function GET() {
  // Use Bun APIs in API routes
  const file = Bun.file("users.json");
  const users = await file.json();

  return NextResponse.json(users);
}
```

```tsx#app/actions.ts
"use server"

import { sql } from "bun:sqlite";

export async function getUser(id: number) {
  // Use Bun SQLite in Server Actions
  const db = sql`SELECT * FROM users WHERE id = ${id}`;
  return db;
}
```

### Available Bun APIs

- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `Bun.file()` for file operations. Prefer over `node:fs`'s readFile/writeFile.
- `Bun.$` for shell commands instead of execa.

### Testing

Use `bun test` to run tests:

```ts#app/actions.test.ts
import { test, expect } from "bun:test";
import { myServerAction } from "./actions";

test("server action works", async () => {
  const formData = new FormData();
  formData.append("name", "test");
  const result = await myServerAction(formData);
  expect(result.success).toBe(true);
});
```

### Important Notes

- **Do NOT use `Bun.serve()`** - Next.js handles the server
- Use Next.js API Routes (`app/api/`) or Route Handlers for API endpoints
- Use Server Actions (`"use server"`) for form submissions and mutations
- Use Server Components for server-side rendering and data fetching
- Bun APIs work in Server Components, Server Actions, API Routes, and Route Handlers

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.md` and the [Next.js documentation](https://nextjs.org/docs).
