// Data from outside is looked at as one type, and a function of another module returns it as a second type with the same properties. It stays the same object, and handing it on tests only that it is an object. A property that holds another kind than its type declares is found at the first typed read of it, which throws a TypeError; null and a missing property pass. A third module, the first to be compiled, casts between two types that hold these two, so the compiler has compared them before it comes to the return.
import { widen, type Line } from "./types";
import { load } from "./load";
import { pass } from "./pass";

const row = load('{"id":1,"name":"parsed"}');
const line = pass(row);
console.log(row === (line as unknown), line.id, line.name);
line.id = 2;
console.log(row.id, line.id);
row.name = "changed";
console.log(row.name, line.name);

const odd = pass(load('{"id":"seven","name":null,"more":true}'));
try {
  console.log(odd.id);
} catch (error) {
  console.log((error as Error).constructor.name);
}
console.log(odd.name, Object.keys(odd).join());
const short = pass(load('{"id":8}'));
console.log(short.id, short.name, Object.keys(short).join());

const own: Line = { id: 3, name: "made here" };
console.log(own.id, own.name, JSON.stringify(own));
const holder = widen({ held: { id: 4, name: "held" } });
console.log(holder.held.id, holder.held.name);
