// What the program is given is looked for once, and the search goes on by the pairs of types that the checker has compared. A type that only looks like one that data is held to keeps its layout. A `delete` from a dictionary elsewhere in the program has nothing to do with that.
// IR+ ^layout L\d+ .*name="Looks" .* representation=Typed
// IR+ : number = PropGet v\d+ name="serial"
interface Row { serial: number; name: string }
interface Looks { serial: number; name: string }
const parsed: Row = JSON.parse('{"serial":1,"name":"x"}');
function make(serial: number): Looks { return { serial, name: "y" }; }
const made: Looks[] = [make(2), make(3)];
let sum = 0;
for (const one of made) sum += one.serial;
console.log(parsed.name, made[0].name, sum);
const table: Record<string, string> = { a: "x", b: "y" };
delete table.a;
console.log(Object.keys(table).join());
