import { Changes, Database } from "bun:sqlite";
import { expectType } from "./utilities.test";

const db = new Database(":memory:");
const query1 = db.query<
  { name: string; dob: number }, // return type first
  { $id: string }
>("select name, dob from users where id = $id");
query1.all({ $id: "asdf" }); // => {name: string; dob:string}[]

const query2 = db.query<
  { name: string; dob: number },
  [string, number] // pass tuple for positional params
>("select ?1 as name, ?2 as dob");
const allResults = query2.all("Shaq", 50); // => {name: string; dob:string}[]
const getResults = query2.get("Shaq", 50); // => {name: string; dob:string}[]

// tslint:disable-next-line:no-void-expression
const runResults = query2.run("Shaq", 50); // => {name: string; dob:string}[]

expectType<Array<{ name: string; dob: number }>>(allResults);
expectType<{ name: string; dob: number } | null>(getResults);
// tslint:disable-next-line:invalid-void
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
expectType<Changes>(runResults);

const query3 = db.prepare<
  { name: string; dob: number }, // return type first
  // eslint-disable-next-line @definitelytyped/no-single-element-tuple-type
  [{ $id: string }]
>("select name, dob from users where id = $id");
const allResults3 = query3.all({ $id: "asdf" });
expectType<Array<{ name: string; dob: number }>>(allResults3);
