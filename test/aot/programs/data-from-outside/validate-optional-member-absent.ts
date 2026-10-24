// An optional member that validate<T>(value) would copy stays absent in the copy when the argument does not have it.
import { validate } from "bun:bundle";
type Nested = { a: number; inner?: { x: number } };
const parse = (text: string): any => JSON.parse(text);

const nested = validate<Nested>(parse('{"a":1}'));
console.log("an object", Object.keys(nested).join(), "inner" in nested);

const list = validate<{ a: number; items?: number[] }>(parse('{"a":1}'));
console.log("an array", Object.keys(list).join(), "items" in list);

const present = validate<Nested>(parse('{"inner":{"x":2},"a":1}'));
console.log("present", Object.keys(present).join(), JSON.stringify(present));

const explicit = parse('{"a":1}');
explicit.inner = undefined;
const kept = validate<Nested>(explicit);
console.log("present and undefined", Object.keys(kept).join(), "inner" in kept, kept.inner);
