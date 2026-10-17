// JSON.stringify calls the toJSON method that an array was given as a property of its own, as in plain Bun, whatever type the array is written at.
function show(name: string, f: () => unknown) { try { console.log(name, f()); } catch (e) { console.log(name, "threw", (e as Error).message); } }
const own: number[] = [1, 2];
(own as any).toJSON = () => "custom";
show("own", () => JSON.stringify(own));
const strings: string[] = ["a"];
(strings as any).toJSON = function (key: string) { return "custom " + JSON.stringify(key) + " " + this.length; };
show("strings", () => JSON.stringify(strings));
const pair: [number, string] = [1, "s"];
(pair as any).toJSON = () => "custom";
show("tuple", () => JSON.stringify(pair));
class List extends Array<number> { toJSON() { return "list of " + this.length; } }
const list: number[] = new List(1, 2);
show("heir at number[]", () => JSON.stringify(list));
show("heir at its class", () => JSON.stringify(new List(1, 2)));
interface Holder { xs: number[]; name: string }
const holder: Holder = { xs: own, name: "h" };
show("in a field", () => JSON.stringify(holder));
const nested: number[][] = [own, [3]];
show("in an array", () => JSON.stringify(nested));
const records: { n: number }[] = [{ n: 1 }];
(records as any).toJSON = () => "custom";
show("array of records", () => JSON.stringify(records));
show("with a replacer", () => JSON.stringify(own, (k, v) => v));
show("with an indent", () => JSON.stringify(own, null, 2));
const through: any = own;
show("through any", () => JSON.stringify(through));
const readonlyOnes: readonly number[] = own;
show("readonly", () => JSON.stringify(readonlyOnes));
const notCallable: number[] = [5];
(notCallable as any).toJSON = 7;
show("toJSON that is no function", () => JSON.stringify(notCallable));
const getter: number[] = [6];
Object.defineProperty(getter, "toJSON", { get() { return () => "from a getter"; } });
show("toJSON by a getter", () => JSON.stringify(getter));
const proto: number[] = Object.setPrototypeOf([7], Object.create(Array.prototype, { toJSON: { value: () => "from the prototype" } }));
show("toJSON on a prototype between", () => JSON.stringify(proto));
const map = new Map<string, number[]>([["k", own]]);
show("out of a Map", () => JSON.stringify(map.get("k")));
function give(xs: number[], text: string): number[] { (xs as any).toJSON = () => text; return xs; }
function write(xs: number[]): string { return JSON.stringify(xs); }
const many: string[] = [];
for (let i = 0; i < 300; i++) many.push(write(i % 3 === 0 ? give([i], "given " + i) : [i]));
show("one store site, many arrays", () => many.filter((text, i) => text !== (i % 3 === 0 ? JSON.stringify("given " + i) : "[" + i + "]")).length);
const late: number[] = [1, 2, 3];
show("before the store", () => write(late));
give(late, "late");
show("after the store", () => write(late));
delete (late as any).toJSON;
show("after it is deleted", () => write(late) + " " + late.length + " " + late.map(x => x * 2).join());
const assigned: number[] = Object.assign([8], { toJSON: () => "assigned" });
show("by Object.assign", () => write(assigned));
const doubles: number[] = give([1.5, 2.5], "doubles");
show("doubles", () => write(doubles) + " " + (doubles[0] + doubles[1]) + " " + doubles.length);
doubles.push(3.5);
show("still an array", () => Array.isArray(doubles) + " " + doubles.length + " " + doubles.reduce((a, b) => a + b, 0) + " " + Object.keys(doubles).join());
