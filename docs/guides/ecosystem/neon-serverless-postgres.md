---
name: Use Neon's Serverless Postgres with Bun
---

[Neon](https://neon.tech/) is a fully managed serverless Postgres. Neon separates compute and storage to offer modern developer features such as autoscaling, branching, bottomless storage, and more.

---

Get started by creating a project directory, initializing the directory using `bun init`, and adding the [Neon serverless driver](https://github.com/neondatabase/serverless/) as a project dependency.

```sh
$ mkdir bun-neon-postgres
$ cd bun-neon-postgres
$ bun init -y
$ bun add @neondatabase/serverless
```

---

Create a `.env.local` file and add your [Neon Postgres connection string](https://neon.tech/docs/connect/connect-from-any-app) to it.

```sh
DATABASE_URL=postgresql://username:password@ep-adj-noun-guid.us-east-1.aws.neon.tech/neondb?sslmode=require
```

---

Paste the following code into your project's `index.ts` file.

```ts
import { neon } from "@neondatabase/serverless";

// Bun automatically loads the DATABASE_URL from .env.local
// Refer to: https://bun.com/docs/runtime/env for more information
const sql = neon(process.env.DATABASE_URL);

const rows = await sql`SELECT version()`;

console.log(rows[0].version);
```

---

Start the program using `bun ./index.ts`. The Postgres version should be printed to the console.

```sh
$ bun ./index.ts
PostgreSQL 16.2 on x86_64-pc-linux-gnu, compiled by gcc (Debian 10.2.1-6) 10.2.1 20210110, 64-bit
```

---

This example used the Neon serverless driver's SQL-over-HTTP functionality. Neon's serverless driver also exposes `Client` and `Pool` constructors to enable sessions, interactive transactions, and node-postgres compatibility.

Refer to [Neon's documentation](https://neon.tech/docs/serverless/serverless-driver) for a complete overview of the serverless driver.
