// By-name reads of properties outside an object's layout (getters of a literal that also has data members, properties added later, absent names) are answered
// by the stubs without calling the runtime, for one object and for many. The jsc shell counts the calls; elsewhere the program checks the values alone.
declare const aotOperationCount: undefined | ((name: string) => number);
const operations = ["operationAOTGetExtraProperty", "operationAOTGetByIdAndCache"];
function entered(): number { let sum = 0; if (typeof aotOperationCount === "function") for (const operation of operations) sum += aotOperationCount(operation); return sum; }
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
measure("getter of one object", 20000, () => { let sum = 0; for (let i = 0; i < 20000; i++) sum += twiceOf(one); return sum; });
const many: Point[] = [];
for (let i = 0; i < 200; i++) many.push(point(i));
measure("two hundred objects of the literal, in turn", 20000, () => { let sum = 0; for (let round = 0; round < 100; round++) for (const each of many) sum += twiceOf(each); return sum; });
measure("absent name", 20000, () => { let sum = 0; for (let round = 0; round < 100; round++) for (const each of many) if (tagOf(each) === undefined) sum++; return sum; });
for (const each of many) (each as any).color = each.x;
measure("property added later", 20000, () => { let sum = 0; for (let round = 0; round < 100; round++) for (const each of many) sum += colorOf(each) as number; return sum; });
const others: any[] = [JSON.parse('{"twice":1}'), JSON.parse('{"a":1,"twice":2}'), JSON.parse('{"a":1,"b":2,"twice":3}'), one];
measure("getter at a polymorphic site", 20000, () => { let sum = 0; for (let i = 0; i < 20000; i++) sum += anyTwiceOf(others[i & 3]); return sum; });
measure("new objects, each read once", 20000, () => { let sum = 0; for (let i = 0; i < 20000; i++) sum += twiceOf(point(i & 15)); return sum; });
console.log(lines.join("\n"));
