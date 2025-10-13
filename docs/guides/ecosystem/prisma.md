---
name: Use Prisma with Bun
---

{% callout %}
**Note** — At the moment Prisma needs Node.js to be installed to run certain generation code. Make sure Node.js is installed in the environment where you're running `bunx prisma` commands.
{% /callout %}

---

Prisma works out of the box with Bun. First, create a directory and initialize it with `bun init`.

```bash
$ mkdir prisma-app
$ cd prisma-app
$ bun init
```

---

Then install the Prisma CLI (`prisma`), Prisma Client (`@prisma/client`), and the PostgreSQL adapter as dependencies.

```bash
$ bun add -d prisma
$ bun add @prisma/client @prisma/adapter-pg
```

---

We'll use the Prisma CLI with `bunx` to initialize our schema and migration directory with [Prisma Postgres](https://www.prisma.io/docs/postgres?utm_source=bun_docs).

```bash
$ bunx prisma init --db
```

---

The `prisma init --db` command creates a basic schema. We need to update it to use the new Rust-free client with Bun optimization. Open `prisma/schema.prisma` and modify the generator block, then add a simple `User` model.

```prisma-diff#prisma/schema.prisma
  generator client {
-   provider = "prisma-client-js"
-   output   = "../generated/prisma"
+   provider = "prisma-client"
+   output = "../generated"
+   engineType = "client"
+   runtime = "bun"
  }

  datasource db {
    provider = "postgresql"
    url      = env("DATABASE_URL")
  }

+ model User {
+   id    Int     @id @default(autoincrement())
+   email String  @unique
+   name  String?
+ }
```

---

Then generate and run initial migration.

This will generate a `.sql` migration file in `prisma/migrations` and execute the migration against your Prisma Postgres database.

```bash
$ bunx prisma migrate dev --name init
Environment variables loaded from .env
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "postgres", schema "public" at "accelerate.prisma-data.net"

Already in sync, no schema change or pending migration was found.

✔ Generated Prisma Client (v6.17.1, engine=none) to ./generated/prisma in 28ms
```

---

As indicated in the output, Prisma re-generates our _Prisma client_ whenever we execute a new migration. The client provides a fully typed API for reading and writing from our database. You can manually re-generate the client with the Prisma CLI.

```sh
$ bunx prisma generate
```

---

Now we need to instantiate the PrismaClient using the PostgreSQL adapter. We can import the generated client and the adapter.

```ts#src/index.ts
import { PrismaClient } from "../generated/client";
import { PrismaPg } from "@prisma/adapter-pg";
```

---

Let's write a simple script to create a new user, then count the number of users in the database.

```ts#index.ts
import { PrismaClient } from "../generated/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// create a new user
await prisma.user.create({
  data: {
    name: "John Dough",
    email: `john-${Math.random()}@example.com`,
  },
});

// count the number of users
const count = await prisma.user.count();
console.log(`There are ${count} users in the database.`);
```

---

Let's run this script with `bun run`. Each time we run it, a new user is created.

```bash
$ bun run index.ts
Created john-0.12802932895402364@example.com
There are 1 users in the database.
$ bun run index.ts
Created john-0.8671308799782803@example.com
There are 2 users in the database.
$ bun run index.ts
Created john-0.4465968383115295@example.com
There are 3 users in the database.
```

---

That's it! Now that you've set up Prisma using Bun, we recommend referring to the [official Prisma docs](https://www.prisma.io/docs/concepts/components/prisma-client) as you continue to develop your application.
