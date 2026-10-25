// The issues of a failed validation are built by one routine that all types share, from a description of the type. No code is emitted per type for them.
// IR- ^function f\d+ - .*\{\n(?:[ ].*\n)*?[ ].* = String string="invalid_type"
// IR- ^function f\d+ - .*\{\n(?:[ ].*\n)*?[ ].* = String string="unrecognized_keys"
// IR- ^function f\d+ - .*\{\n(?:[ ].*\n)*?[ ].* = String string="path"
// IR= 0 report : =?L[0-9]+ = NewObject 
// SIZE< report 14000
import { JSON } from "bun"; import type { Schema } from "bun";
interface Address { street: string; zip: string & Schema.MaxLength<5> }
interface Person {
  name: string;
  age: number & Schema.Int & Schema.Min<0> & Schema.Message<"age must be a whole number from 0 up">;
  address: Address;
  tags: string[] & Schema.MinItems<1>;
  pair: [number, string];
  scores: Record<string, number>;
  role: "admin" | "user" | { custom: string };
  nickname?: string;
  level: number & Schema.Default<1>;
}
function issuesOf(run: () => unknown): string {
  try {
    return "accepted " + JSON.stringify(run());
  } catch (error) {
    const failure = error as Error & { issues?: unknown };
    return failure.constructor.name + " " + failure.message + " " + JSON.stringify(failure.issues);
  }
}
const good = { name: "n", age: 3, address: { street: "s", zip: "12345" }, tags: ["t"], pair: [1, "p"], scores: { a: 1 }, role: "user" };
const inputs: unknown[] = [
  good,
  { ...good, role: { custom: "c" }, nickname: "k", level: 2, extra: true },
  {},
  null,
  [],
  { ...good, age: -1 },
  { ...good, age: 1.5, address: { street: 1, zip: "123456" }, tags: [], pair: [1], scores: { a: "x", b: 2 }, role: "owner", nickname: 5, level: "high" },
  { ...good, address: null, tags: "t", pair: ["1", 2], scores: [], role: { custom: 1 } },
];
for (const input of inputs) console.log(issuesOf(() => JSON.parse<Person>(JSON.stringify(input))));
console.log(issuesOf(() => JSON.parse<Address & Schema.Strict>('{"street":"s","zip":"1","city":"c","country":"d"}')));
console.log(issuesOf(() => JSON.parse<Person>("{")), issuesOf(() => JSON.parse<Address[]>('[{"street":"s","zip":"1"},{"street":"s"}]')));
