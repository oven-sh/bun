class Leaf { constructor(public weight: number) {} }
class Holder { items: Leaf[] = []; other: Leaf[] = []; count = 0; }
const world: any = globalThis;
const lines: string[] = [];
function show(value: any): string {
    if (value instanceof Leaf) return "leaf" + value.weight;
    if (typeof value === "symbol") return "symbol";
    if (typeof value === "function") return "function";
    if (Object.is(value, -0)) return "-0";
    if (Array.isArray(value)) return "[" + Array.from(value, show).join() + "]";
    return String(value);
}
function attempt(run: () => any) { try { lines.push(show(run())); } catch (error: any) { lines.push("threw " + error.constructor.name); } }
function describe(list: any) { try { return show(Array.from({ length: Math.min(list.length >>> 0, 12) }, (_, at) => list[at])) + " length " + list.length + " keys " + Reflect.ownKeys(list).map(show).join(); } catch (error: any) { return "threw " + error.constructor.name; } }
function plain(): any { return [new Leaf(1), new Leaf(2), new Leaf(3), new Leaf(4)]; }
let cells: any[] = [0.5, 1.5, 2.5, 3.5];
let position: any = 0;
function put(value: any) { cells[position] = value; }
function move(to: any) { position = to; }
for (let round = 0; round < 5; round++) {
    move(round === 2 || round === 3 ? 1 : round);
    attempt(() => { put(new Leaf(30 + round)); return describe(cells); });
}
console.log(lines.join("\n"));
