// A closed read of `size` is answered out of the table where the receiver is a Map or a Set as its class made it, or an instance of a class below whose structure is kept.
// The count says that structures are kept here: without it every read could go on to the read of any name, and all the answers would still be right.
// COUNT: counter:StructuresInheritingBuiltinMethods >= 2
class Tracked extends Map<unknown, unknown> { tag = 1; }
class Bag extends Set<unknown> { tag = 2; }
const things: any[] = [new Tracked(), new Bag(), new Map(), new Set()];
things[0].set(1, 1); things[0].set(2, 2); things[1].add(1); things[2].set(1, 1); things[3].add(1); things[3].add(2); things[3].add(3);
function sizeOf(thing: any) { return thing.size; }
let out = "";
for (let turn = 0; turn < 400; turn++) for (const thing of things) { const size = sizeOf(thing); if (turn === 0 || turn === 399) out += String(size) + " "; }
console.log(out);
