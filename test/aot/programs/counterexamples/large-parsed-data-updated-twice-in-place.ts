// Parsed JSON of nine members is updated twice through an array, an object, a Map and a Record, and both updates count.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
interface Sub { v: number }
interface Big { a: number; b: number; c: number; d: number; e: number; f: number; g: number; h: number; sub: Sub | null }
const madeBig: Big = { a: 0.5, b: 1.5, c: 2.5, d: 3.5, e: 4.5, f: 5.5, g: 6.5, h: 7.5, sub: { v: 1 } };
function first(x: Big): number { x.a += 1; return x.a }
row("(made by typed code)", () => first(madeBig));
const bigText = '{"a":0.5,"b":1.5,"c":2.5,"d":3.5,"e":4.5,"f":5.5,"g":6.5,"h":7.5,"sub":null}';
row("updates through the array, in argument position", () => { const l: Big[] = JSON.parse("[" + bigText + "]"); first(l[0]); first(l[0]); return l[0].a });
row("the same through a function's result", () => { const l: Big[] = parse("[" + bigText + "]"); first(l[0]); first(l[0]); return l[0].a });
row("the same by a method", () => { const l: Big[] = parse("[" + bigText + "]"); l.forEach(x => { first(x) }); l.forEach(x => { first(x) }); return l[0].a });
row("the same by for..of", () => { const l: Big[] = parse("[" + bigText + "]"); for (const x of l) first(x); for (const x of l) first(x); return l[0].a });
row("the same below an object", () => { const h: { big: Big } = parse('{"big":' + bigText + '}'); first(h.big); first(h.big); return h.big.a });
row("the same in a Map", () => { const m = new Map<string, Big>(); m.set("k", parse(bigText)); first(m.get("k")!); first(m.get("k")!); return m.get("k")!.a });
row("the same in a Record", () => { const d: Record<string, Big> = parse('{"k":' + bigText + '}'); first(d.k); first(d["k"]); return d.k.a });
