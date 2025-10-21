---
name: Use Neon Postgres through Drizzle ORM
---

[Neon](https://neon.tech/) is a fully managed serverless Postgres, separating compute and storage to offer features like autoscaling, branching and bottomless storage. Neon can be used from Bun directly using the `@neondatabase/serverless` driver or through an ORM like `Drizzle`.

Drizzle ORM supports both a SQL-like "query builder" API and an ORM-like [Queries API](https://orm.drizzle.team/docs/rqb). Get started by creating a project directory, initializing the directory using `bun init`, and installing Drizzle and the [Neon serverless driver](https://github.com/neondatabase/serverless/).

```sh
$ mkdir bun-drizzle-neon
$ cd bun-drizzle-neon
$ bun init -y
$ bun add drizzle-orm @neondatabase/serverless
$ bun add -D drizzle-kit
```

---

Create a `.env.local` file and add your [Neon Postgres connection string](https://neon.tech/docs/connect/connect-from-any-app) to it.

```sh
DATABASE_URL=postgresql://username:password@ep-adj-noun-guid.us-east-1.aws.neon.tech/neondb?sslmode=require
```

---

We will connect to the Neon database using the Neon serverless driver, wrapped in a Drizzle database instance.

```ts#db.ts
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';

// Bun automatically loads the DATABASE_URL from .env.local
// Refer to: https://bun.com/docs/runtime/env for more information
const sql = neon(process.env.DATABASE_URL!);

export const db = drizzle(sql);
```

---

To see the database in action, add these lines to `index.ts`.

```ts#index.ts
import { db } from "./db";
import { sql } from "drizzle-orm";

const query = sql`select 'hello world' as text`;
const result = await db.execute(query);
console.log(result.rows);
```

---

Then run `index.ts` with Bun.

```sh
$ bun run index.ts
[
  {
    text: "hello world",
  }
]
```

---

We can define a schema for our database using Drizzle ORM primitives. Create a `schema.ts` file and add this code.

```ts#schema.ts
import { pgTable, integer, serial, text, timestamp } from "drizzle-orm/pg-core";

export const authors = pgTable("authors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  bio: text("bio"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
```

---

We then use the `drizzle-kit` CLI to generate an initial SQL migration.

```sh
$ bunx drizzle-kit generate --dialect postgresql --schema ./schema.ts --out ./drizzle
```

---

This creates a new `drizzle` directory containing a `.sql` migration file and `meta` directory.

```txt
drizzle
├── 0000_aspiring_post.sql
└── meta
    ├── 0000_snapshot.json
    └── _journal.json
```

---

We can execute these migrations with a simple `migrate.ts` script. This script creates a new connection to the Neon database and executes all unexecuted migrations in the `drizzle` directory.

```ts#migrate.ts
import { db } from './db';
import { migrate } from "drizzle-orm/neon-http/migrator";

const main = async () => {
  try {
    await migrate(db, { migrationsFolder: "drizzle" });
    console.log("Migration completed");
  } catch (error) {
    console.error("Error during migration:", error);
    process.exit(1);
  }
};

main();
```

---

We can run this script with `bun` to execute the migration.

```sh
$ bun run migrate.ts
Migration completed
```

---

We can now add some data to our database. Create a `seed.ts` file with the following contents.

```ts#seed.ts
import { db } from "./db";
import * as schema from "./schema";

async function seed() {
  await db.insert(schema.authors).values([
    {
      name: "J.R.R. Tolkien",
      bio: "The creator of Middle-earth and author of The Lord of the Rings.",
    },
    {
      name: "George R.R. Martin",
      bio: "The author of the epic fantasy series A Song of Ice and Fire.",
    },
    {
      name: "J.K. Rowling",
      bio: "The creator of the Harry Potter series.",
    },
  ]);
}

async function main() {
  try {
    await seed();
    console.log("Seeding completed");
  } catch (error) {
    console.error("Error during seeding:", error);
    process.exit(1);
  }
}

main();
```

---

Then run this file.

```sh
$ bun run seed.ts
Seeding completed
```

---

We now have a database with a schema and sample data. We can use Drizzle to query it. Replace the contents of `index.ts` with the following.

```ts#index.ts
import * as schema from "./schema";
import { db } from "./db";

const result = await db.select().from(schema.authors);
console.log(result);
```

---

Then run the file. You should see the three authors we inserted.

```sh
$ bun run index.ts
[
  {
    id: 1,
    name: "J.R.R. Tolkien",
    bio: "The creator of Middle-earth and author of The Lord of the Rings.",
    createdAt: 2024-05-11T10:28:46.029Z,
  }, {
    id: 2,
    name: "George R.R. Martin",
    bio: "The author of the epic fantasy series A Song of Ice and Fire.",
    createdAt: 2024-05-11T10:28:46.029Z,
  }, {
    id: 3,
    name: "J.K. Rowling",
    bio: "The creator of the Harry Potter series.",
    createdAt: 2024-05-11T10:28:46.029Z,
  }
]
```

---

This example used the Neon serverless driver's SQL-over-HTTP functionality. Neon's serverless driver also exposes `Client` and `Pool` constructors to enable sessions, interactive transactions, and node-postgres compatibility. Refer to [Neon's documentation](https://neon.tech/docs/serverless/serverless-driver) for a complete overview.

Refer to the [Drizzle website](https://orm.drizzle.team/docs/overview) for more documentation on using the Drizzle ORM.
