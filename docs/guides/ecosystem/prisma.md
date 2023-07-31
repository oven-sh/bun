---
name: Get started using Prisma
---

Prisma works our of the box with Bun. First, create a directory and initialize it with `bun init`.

```bash
mkdir prisma-app
cd prisma-app
bun init
```

---

Then add Prisma as a dependency.

```bash
bun add prisma
```

---

We'll use the Prisma CLI with `bunx` to initialize our schema and migration directory. For simplicity we'll be using an in-memory SQLite database.

```bash
bunx prisma init --datasource-provider sqlite
```

---

Open `prisma/schema.prisma` and add a simple `User` model.

```prisma-diff#prisma/schema.prisma
  generator client {
    provider = "prisma-client-js"
  }

  datasource db {
    provider = "sqlite"
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

This will generate a `.sql` migration file in `prisma/migrations`, create a new SQLite instance, and execute the migration against the new instance.

```bash
bunx prisma migrate dev --name init
```

---

Prisma automatically generates our _Prisma client_ whenever we execute a new migration. The client provides a fully typed API for reading and writing from our database.

It can be imported from `@prisma/client`.

```ts#src/index.ts
import {PrismaClient} from "@prisma/client";
```

---

Let's write a simple script to create a new user, then count the number of users in the database.

```ts#index.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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
