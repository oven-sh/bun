---
name: Use Orange ORM with Bun
---

[Orange ORM](https://github.com/alfateam/orange-orm) is a modern, TypeScript-first ORM that runs in Bun, Node.js, Deno and the browser. It follows the Active-Record pattern and ships with an expressive, LINQ-style query API. Key features include:

- Rich querying and deep filtering  
- Active-Record-style change tracking
- Fully-typed models with **zero code-generation**

---

Let's get started by creating a fresh project with `bun init` and installing Orange ORM.

```sh
$ bun init -y
$ bun add orange-orm
```

---

Then we will create the table schema and connect to the database.

```ts#db.ts
import orange from 'orange-orm';

const map = orange.map(x => ({
  task: x.table('task').map(({ column }) => ({
    id: column('id').numeric().primary(),
    title: column('title').string(),
    done: column('done').boolean(),
  })),
}));

export default map.sqlite('orange.db');

```

---

The next snippet creates the `task` table (if it doesn't exist), seeds it with a few sample rows the first time it runs, queries every task that is still **not** done, prints the result, and finally closes the connection.

```ts#index.ts
import db from './db';
await db.query(`
  create table if not exists task (
    id integer primary key,
    title text,
    done integer default 0
  )
`);

const count = await db.task.count();
if (count === 0)
  await db.task.insert([
    { title: 'Wake up', done: true },
    { title: 'Write docs', done: false },
    { title: 'Eat dinner', done: false },
    { title: 'Brush teeth', done: false },
  ]);


const tasks = await db.task.getAll({
  where: x => x.done.eq(false),
});

console.log(JSON.stringify(tasks));

await db.close();
```

---

Then run `index.ts` with Bun. Bun will automatically create `orange.db` and execute the query.

```sh
$ bun run index.ts
[{"id":2,"title":"Write docs","done":false},{"id":3,"title":"Eat dinner","done":false},{"id":4,"title":"Brush teeth","done":false}]
```

---

For more details, check out the complete [Orange ORM documentation.](https://github.com/alfateam/orange-orm/blob/master/README.md)
