import {
  DummyDriver,
  type Generated,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
} from "kysely";

interface Database {
  person: { id: Generated<number>; first_name: string; age: number | null };
  pet: { id: Generated<number>; owner_id: number; name: string };
}
const db = new Kysely<Database>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: db => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});
const selected = db
  .selectFrom("person")
  .innerJoin("pet", "pet.owner_id", "person.id")
  .select(["person.first_name", "pet.name as pet_name"])
  .where("person.age", ">", 18)
  .orderBy("person.id", "desc")
  .limit(5)
  .compile();
console.log(selected.sql, JSON.stringify(selected.parameters));
const inserted = db.insertInto("person").values({ first_name: "Jennifer", age: 40 }).returning("id").compile();
console.log(inserted.sql, JSON.stringify(inserted.parameters));
const raw = db
  .selectFrom("person")
  .select(({ fn }) => [fn.count<number>("id").as("count"), sql<string>`upper(first_name)`.as("loud")])
  .groupBy("first_name")
  .compile();
console.log(raw.sql);
console.log(JSON.stringify(await db.selectFrom("pet").selectAll().execute()));
await db.destroy();
