---
name: Use Prisma Postgres with Bun
---

{% callout %}
**Note** — At the moment Prisma needs Node.js to be installed to run certain generation code. Make sure Node.js is installed in the environment where you're running `bunx prisma` commands.
{% /callout %}

---

Prisma works out of the box with Bun and PostgreSQL. First, create a directory and initialize it with `bun init`.

```bash
$ mkdir prisma-postgres-app
$ cd prisma-postgres-app
$ bun init
```

---

Then install the Prisma CLI (`prisma`), Prisma Client (`@prisma/client`), and the accelerate extension as dependencies.

```bash
$ bun add -d prisma
$ bun add @prisma/client @prisma/extension-accelerate
```

---

We'll use the Prisma CLI with `bunx` to initialize our schema and migration directory. We'll be using PostgreSQL as our database.

```bash
$ bunx --bun prisma init --db
```

This creates a basic schema. We need to update it to use the new Rust-free client with Bun optimization. Open `prisma/schema.prisma` and modify the generator block, then add a simple `User` model.

```prisma-diff#prisma/schema.prisma
  generator client {
    provider = "prisma-client"
+   output = "./generated"
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

Set up your Postgres database URL in the `.env` file.

```bash#.env
DATABASE_URL="postgresql://username:password@localhost:5432/mydb?schema=public"
```

---

Then generate and run initial migration.

This will generate a `.sql` migration file in `prisma/migrations`, and execute the migration against your Postgres database.

```bash
$ bunx --bun prisma migrate dev --name init
Environment variables loaded from .env
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "mydb", schema "public" at "localhost:5432"

Applying migration `20250114141233_init`

The following migration(s) have been created and applied from new schema changes:

prisma/migrations/
  └─ 20250114141233_init/
    └─ migration.sql

Your database is now in sync with your schema.

✔ Generated Prisma Client (6.17.1) to ./generated in 18ms
```

---

As indicated in the output, Prisma re-generates our _Prisma client_ whenever we execute a new migration. The client provides a fully typed API for reading and writing from our database. You can manually re-generate the client with the Prisma CLI.

```sh
$ bunx --bun prisma generate
```

---

Now we need to create a Prisma client instance. Create a new file `prisma/db.ts` to initialize the PrismaClient with the Postgres adapter.

```ts#prisma/db.ts
import { PrismaClient } from "./generated/client";
import { withAccelerate } from '@prisma/extension-accelerate'

export const prisma = new PrismaClient().$extends(withAccelerate())
```

---

Let's write a simple script to create a new user, then count the number of users in the database.

```ts#index.ts
import { prisma } from "./prisma/db";

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
There are 1 users in the database.
$ bun run index.ts
There are 2 users in the database.
$ bun run index.ts
There are 3 users in the database.
```

---

That's it! Now that you've set up Prisma Postgres using Bun, we recommend referring to the [official Prisma Postgres docs](https://www.prisma.io/docs/postgres) as you continue to develop your application.
