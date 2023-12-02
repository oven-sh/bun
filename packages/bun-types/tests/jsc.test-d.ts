import { serialize, deserialize } from "bun:jsc";
import { deepEquals } from "bun";
const obj = { a: 1, b: 2 };
const buffer = serialize(obj);
const clone = deserialize(buffer);

if (deepEquals(obj, clone)) {
  console.log("They are equal!");
}
