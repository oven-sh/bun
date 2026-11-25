// util.inspect() is prepared for an export that cannot be read: it expects the ReferenceError of a binding that is not initialized, and fails an assertion of its own at any other error.
import { inspect } from "node:util";
import { a } from "./rows.json";
const load = (0, eval)("p => import(p)");
const got = await load(import.meta.dirname + "/rows.json");
try {
  console.log(a, inspect(got).includes("b: 2"));
} catch (error) {
  console.log(a, error.code, error.message.split("\n")[0]);
}
