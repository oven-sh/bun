---
name: Use EdgeDB with Bun
---

EdgeDB is a graph-relational database powered by Postgres under the hood. It provides a declarative schema language, migrations system, and object-oriented query language, in addition to supporting raw SQL queries. It solves the object-relational mapping problem at the database layer, eliminating the need for an ORM library in your application code.

---

First, [install EdgeDB](https://www.edgedb.com/install) if you haven't already.

{% codetabs %}

```sh#Linux/macOS
$ curl --proto '=https' --tlsv1.2 -sSf https://sh.edgedb.com | sh
```

```sh#Windows
$ iwr https://ps1.edgedb.com -useb | iex
```

{% /codetabs %}

---

Use `bun init` to create a fresh project.

```sh
$ mkdir my-edgedb-app
$ cd my-edgedb-app
$ bun init -y
```

---

We'll use the EdgeDB CLI to initialize an EdgeDB instance for our project. This creates an `edgedb.toml` file in our project root.

```sh
$ edgedb project init
No `edgedb.toml` found in `/Users/colinmcd94/Documents/bun/fun/examples/my-edgedb-app` or above
Do you want to initialize a new project? [Y/n]
> Y
Specify the name of EdgeDB instance to use with this project [default: my_edgedb_app]:
> my_edgedb_app
Checking EdgeDB versions...
Specify the version of EdgeDB to use with this project [default: x.y]:
> x.y
┌─────────────────────┬────────────────────────────────────────────────────────────────────────┐
│ Project directory   │ /Users/colinmcd94/Documents/bun/fun/examples/my-edgedb-app             │
│ Project config      │ /Users/colinmcd94/Documents/bun/fun/examples/my-edgedb-app/edgedb.toml │
│ Schema dir (empty)  │ /Users/colinmcd94/Documents/bun/fun/examples/my-edgedb-app/dbschema    │
│ Installation method │ portable package                                                       │
│ Version             │ x.y+6d5921b                                                            │
│ Instance name       │ my_edgedb_app                                                          │
└─────────────────────┴────────────────────────────────────────────────────────────────────────┘
Version x.y+6d5921b is already downloaded
Initializing EdgeDB instance...
Applying migrations...
Everything is up to date. Revision initial
Project initialized.
To connect to my_edgedb_app, run `edgedb`
```

---

To see if the database is running, let's open a REPL and run a simple query.

Then run `\quit` to exit the REPL.

```sh
$ edgedb
edgedb> select 1 + 1;
2
edgedb> \quit
```

---

With the project initialized, we can define a schema. The `edgedb project init` command already created a `dbschema/default.esdl` file to contain our schema.

```txt
dbschema
├── default.esdl
└── migrations
```

---

Open that file and paste the following contents.

```txt
module default {
  type Movie {
    required title: str;
    releaseYear: int64;
  }
};
```

---

Then generate and apply an initial migration.

```sh
$ edgedb migration create
Created /Users/colinmcd94/Documents/bun/fun/examples/my-edgedb-app/dbschema/migrations/00001.edgeql, id: m1uwekrn4ni4qs7ul7hfar4xemm5kkxlpswolcoyqj3xdhweomwjrq
$ edgedb migrate
Applied m1uwekrn4ni4qs7ul7hfar4xemm5kkxlpswolcoyqj3xdhweomwjrq (00001.edgeql)
```

---

With our schema applied, let's execute some queries using EdgeDB's JavaScript client library. We'll install the client library and EdgeDB's codegen CLI, and create a `seed.ts`.file.

```sh
$ bun add edgedb
$ bun add -D @edgedb/generate
$ touch seed.ts
```

---

Paste the following code into `seed.ts`.

The client auto-connects to the database. We insert a couple movies using the `.execute()` method. We will use EdgeQL's `for` expression to turn this bulk insert into a single optimized query.

```ts
import { createClient } from "edgedb";

const client = createClient();

const INSERT_MOVIE = `
  with movies := <array<tuple<title: str, year: int64>>>$movies
  for movie in array_unpack(movies) union (
    insert Movie {
      title := movie.title,
      releaseYear := movie.year,
    }
  )
`;

const movies = [
  { title: "The Matrix", year: 1999 },
  { title: "The Matrix Reloaded", year: 2003 },
  { title: "The Matrix Revolutions", year: 2003 },
];

await client.execute(INSERT_MOVIE, { movies });

console.log(`Seeding complete.`);
process.exit();
```

---

Then run this file with Bun.

```sh
$ bun run seed.ts
Seeding complete.
```

---

EdgeDB implements a number of code generation tools for TypeScript. To query our newly seeded database in a typesafe way, we'll use `@edgedb/generate` to code-generate the EdgeQL query builder.

```sh
$ bunx @edgedb/generate edgeql-js
Generating query builder...
Detected tsconfig.json, generating TypeScript files.
   To override this, use the --target flag.
   Run `npx @edgedb/generate --help` for full options.
Introspecting database schema...
Writing files to ./dbschema/edgeql-js
Generation complete! 🤘
Checking the generated query builder into version control
is not recommended. Would you like to update .gitignore to ignore
the query builder directory? The following line will be added:

   dbschema/edgeql-js

[y/n] (leave blank for "y")
> y
```

---

In `index.ts`, we can import the generated query builder from `./dbschema/edgeql-js` and write a simple select query.

```ts
import { createClient } from "edgedb";
import e from "./dbschema/edgeql-js";

const client = createClient();

const query = e.select(e.Movie, () => ({
  title: true,
  releaseYear: true,
}));

const results = await query.run(client);
console.log(results);

results; // { title: string, releaseYear: number | null }[]
```

---

Running the file with Bun, we can see the list of movies we inserted.

```sh
$ bun run index.ts
[
  {
    title: "The Matrix",
    releaseYear: 1999
  }, {
    title: "The Matrix Reloaded",
    releaseYear: 2003
  }, {
    title: "The Matrix Revolutions",
    releaseYear: 2003
  }
]
```

---

For complete documentation, refer to the [EdgeDB docs](https://www.edgedb.com/docs).
