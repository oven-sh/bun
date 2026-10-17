// Reads by name of what an object keeps beside its fields (the getters of a literal that also has data members, properties added later, names it lacks) are answered
// without entering the runtime, for one object and for many. The program counts the entries.
declare const aotOperationCount: (name: string) => number;
const states = ["no-slot", "untried-slot", "shared-slot", "polymorphic-slot", "filled-slot", "abandoned-filled-slot", "abandoned-slot", "retried-slot"];
function entered(): number { let sum = 0; for (const state of states) sum += aotOperationCount("operationAOTGetById:" + state); return sum; }
const lines: string[] = [];
function measure(label: string, reads: number, run: () => number): void {
    const before = entered();
    const result = run();
    const entries = entered() - before;
    lines.push(label + ": " + result + ", " + (entries * 20 < reads ? "few entries" : entries + " ENTRIES FOR " + reads + " READS"));
}
interface Point { x: number; readonly twice: number }
function point(x: number): Point { return { x, get twice() { return this.x * 2; } }; }
function twiceOf(from: any): number { return from.twice; }
function tagOf(from: any): unknown { return from.tag; }
function colorOf(from: any): unknown { return from.color; }
function anyTwiceOf(from: any): number { return from.twice; }

const one = point(3);
measure("one object, its getter", 20000, () => { let sum = 0; for (let i = 0; i < 20000; i++) sum += twiceOf(one); return sum; });
const many: Point[] = [];
for (let i = 0; i < 200; i++) many.push(point(i));
measure("two hundred objects of the literal, in turn", 20000, () => { let sum = 0; for (let round = 0; round < 100; round++) for (const each of many) sum += twiceOf(each); return sum; });
measure("a name they lack", 20000, () => { let sum = 0; for (let round = 0; round < 100; round++) for (const each of many) if (tagOf(each) === undefined) sum++; return sum; });
for (const each of many) (each as any).color = each.x;
measure("a value they were given later", 20000, () => { let sum = 0; for (let round = 0; round < 100; round++) for (const each of many) sum += colorOf(each) as number; return sum; });
const others: any[] = [JSON.parse('{"twice":1}'), JSON.parse('{"a":1,"twice":2}'), JSON.parse('{"a":1,"b":2,"twice":3}'), one];
measure("where objects of other kinds arrive too", 20000, () => { let sum = 0; for (let i = 0; i < 20000; i++) sum += anyTwiceOf(others[i & 3]); return sum; });
measure("new objects, each read once", 20000, () => { let sum = 0; for (let i = 0; i < 20000; i++) sum += twiceOf(point(i & 15)); return sum; });
console.log(lines.join("\n"));
