// JSON.parse<T>: a union goes on to its next arm only after a sure refusal. Repeated keys, undeclared members, defaults and the order of keys never change which arm is taken, what is refused or how long it takes.
import type { Schema } from "bun";

function shown(parse: () => unknown): string {
  try {
    return "accepted " + JSON.stringify(parse());
  } catch (error: any) {
    return "refused " + error.name + " with " + (error.issues ? error.issues.length : "no") + " issues";
  }
}

type Sized = { a: number; d: number & Schema.Default<1> };
console.log("undeclared member first:", shown(() => JSON.parse<Sized | Record<string, number>>('{"x":0,"a":1}')));
console.log("undeclared member last, then white space:", shown(() => JSON.parse<Sized | Record<string, number>>('{"a":1,"x":0 }')));
console.log("undeclared members everywhere:", shown(() => JSON.parse<{ a: number; b: number }>('{"x":0 , "a":1,"y":[1] ,"b":2,"z":null\n}')));
console.log("undeclared member, then a trailing comma:", shown(() => JSON.parse<Sized>('{"a":1,"x":0,}')));

type Counted = { x: number; d: number & Schema.Default<1> };
console.log("first of two members has another type:", shown(() => JSON.parse<Counted | Record<string, unknown>>('{"x":"s","x":1}')));
console.log("last of two members has another type:", shown(() => JSON.parse<Counted | Record<string, unknown>>('{"x":1,"x":"s"}')));
console.log("only member has another type:", shown(() => JSON.parse<Counted | Record<string, unknown>>('{"x":"s"}')));
console.log("same, keys out of order:", shown(() => JSON.parse<Counted | Record<string, unknown>>('{"d":2,"x":"s","x":1}')));
console.log("same, one level down:", shown(() => JSON.parse<{ in: Counted } | { in: Record<string, unknown> }>('{"in":{"x":"s","x":1}}')));

type Marked = { a: unknown; d: number & Schema.Default<1> };
console.log("dictionary key again:", shown(() => JSON.parse<Record<string, number> | Marked>('{"a":"s","a":1}')));
console.log("dictionary key once:", shown(() => JSON.parse<Record<string, number> | Marked>('{"a":"s"}')));
type Indexed = { k: number; [key: string]: number };
console.log("key under an index signature again:", shown(() => JSON.parse<Indexed | { k: number; q: unknown; d: number & Schema.Default<1> }>('{"k":1,"q":"s","q":2}')));

console.log("default below its minimum:", shown(() => JSON.parse<{ port: number & Schema.Min<1024> & Schema.Default<80> }>("{}")));
console.log("same on the generic path:", shown(() => JSON.parse<{ port: number & Schema.Min<1024> & Schema.Default<80> }>('{"\\u0078":1}')));
console.log("null for a string:", shown(() => JSON.parse<{ name: string & Schema.Default<null> }>("{}")));
console.log("null for an object:", shown(() => JSON.parse<{ inner: { v: number } & Schema.Default<null> }>("{}")));
console.log("string for a number:", shown(() => JSON.parse<{ port: number & Schema.Default<"80"> }>("{}")));
console.log("defaults that fit:", shown(() => JSON.parse<{ port: number & Schema.Min<1> & Schema.Default<80>; host: string & Schema.Default<"localhost"> }>("{}")));
console.log("defaults after the keys of the text:", shown(() => JSON.parse<{ port: number & Schema.Default<80>; host: string }>('{"more":1,"host":"h"}')));
console.log("default in an arm of a member:", shown(() => JSON.parse<{ z: (number & Schema.Default<1>) | string }>("{}")));
console.log("refused default, then another arm:", shown(() => JSON.parse<{ port: number & Schema.Min<1024> & Schema.Default<80> } | Record<string, number>>("{}")));

interface User { id: number; name?: string; email?: string }
console.log("optional members out of order:", shown(() => JSON.parse<User>('{"id":1,"email":"e","name":"n"}')));
console.log("every member out of order:", shown(() => JSON.parse<User>('{"email":"e","more":[],"name":"n","id":1}')));

console.log("strict:", shown(() => JSON.parse<{ id: number } & Schema.Strict>('{"id":1}')), shown(() => JSON.parse<{ id: number } & Schema.Strict>('{"id":1,"more":2}')));

interface Nested { child?: Nested; a: number; b: number }
let text = '{"b":1,"a":1}';
for (let level = 0; level < 64; level++) text = '{"child":' + text + ',"b":1,"a":1}';
let levels = 0;
for (let node: Nested | undefined = JSON.parse<Nested>(text); node; node = node.child) levels++;
console.log("keys out of order at every level:", levels);
