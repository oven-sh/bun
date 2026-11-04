const app = { db: new Bun.sql(":memory:") };
if (!app.db) console.log("no database");
else console.log((await app.db`select 1 as one`)[0].one);
