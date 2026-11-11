// STATISTIC: IteratorAllocationsElidedInSpreads >= 8
// The spread of keys | values as the arguments of a call, twice in one list, off a receiver that is chosen, under a try, in a generator and an async function, and with a receiver whose method is read by a getter.
function show(list: any[]): string { return list.length + ":" + list.join(","); }
function two(a: any, b: any) { return String(a) + "/" + String(b); }
function rest(...all: any[]) { return all.length + "#" + all.join("+"); }
const m = new Map<any, any>([[1, 10], [2, 20], [3, 5]]);
const n = new Map<any, any>([["a", "x"], ["b", "y"]]);
const s = new Set<any>([4, 9, 2]);
const log: string[] = [];
const sly: any = new Map<any, any>([[1, "one"]]);
Object.defineProperty(sly, "values", { get() { log.push("read"); sly.set(2, "two"); return Map.prototype.values; }, configurable: true });
function* steps(c: Map<any, any>) { yield show([...c.values()]); yield show([...c.keys()]); }
async function waits(c: Map<any, any>) { const first = [...c.values()]; await null; return show([...first, ...c.keys()]); }
function thrower(c: any) { try { return show([...c.values()]); } catch (e: any) { return e.constructor.name; } }
const lines: string[] = [];
for (let i = 0; i < 4; i++) {
  const c = i & 1 ? m : n;
  lines.push([i, Math.max(...m.values()), Math.min(...s.keys()), two(...(c.values() as any as [any, any])), rest(...c.keys()), rest(0, ...c.values(), 1), show([...c.values(), ...c.values()]), show([...c.keys(), "-", ...s.values()]),
    show([...(i & 2 ? m : n).values()]), show([...new Set([...c.keys()]).values()]), show([...steps(c)]), thrower(c), thrower(null), thrower({ values() { return [7]; } }), thrower({ values: 5 }), show([...sly.values()]), show([[...c.values()].length])].join(" | "));
}
waits(m).then(said => { lines.push(said); console.log(lines.join("\n")); console.log(log.join()); });
