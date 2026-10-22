// Purity through calls: what a callee does with what it is handed.
const registry: object[] = [];
const outer = { hits: 0 };
function fresh(n: number) { return { n, list: [n] }; }
function fill<T extends object>(target: T, key: string, value: unknown) { (target as any)[key] = value; return target; }
function register<T extends object>(value: T) { registry.push(value); return value; }
function touch() { outer.hits++; return { t: 1 }; }
function peek() { return { seen: outer.hits }; }
function maybeThrow(flag: boolean) { if (flag) throw new TypeError("no"); return { ok: true }; }
function loop(n: number) { const out: number[] = []; for (let i = 0; i < n; i++) out.push(i); return out; }
function recursive(n: number): { depth: number } { return n ? recursive(n - 1) : { depth: 0 }; }
function callsBack(f: () => unknown) { return { r: f() }; }
function keepsArgument(value: object) { return { kept: value }; }
function definesOn(f: Function, name: string) { Object.defineProperty(f, "label", { value: name }); return f; }
const a = fresh(1);
const b = fill({ x: 1 }, "y", 2);
const c = fill(a, "late", 3);
const d = register({ r: 1 });
const e = touch();
const f = peek();
const g = maybeThrow(false);
const h = loop(4);
const i = recursive(3);
const j = callsBack(() => outer.hits);
const k = callsBack(() => 5);
const l = keepsArgument(a);
const m = definesOn(() => 1, "m");
const n = definesOn(fresh, "fresh");
// One helper, many constants: what it does depends on which text or number it is handed.
const said: string[] = [];
function byText(kind: string) { if (kind === "loud") said.push("text " + outer.hits); return { kind }; }
function byNumber(code: number) { if (code === 3) said.push("number " + outer.hits); return { code, twice: code * 2 }; }
function byFlag(flag: boolean) { if (flag) said.push("flag " + outer.hits); return { flag }; }
function byKey(target: Record<string, unknown>, key: string) { target[key] = outer.hits; return target; }
function entry(code: number, key: string, text: string) { return { code, key, text }; }
const quiet = byText("quiet"), loud = byText("loud"), calm = byText("calm");
const one = byNumber(1), three = byNumber(3), four = byNumber(4);
const off = byFlag(false), on = byFlag(true);
const keyed = byKey(byKey({}, "first"), "second");
const table = { a: entry(1, "a", "A"), b: entry(2, "b", "B"), c: entry(3, "c", "C"), d: entry(4, "d", "D") };
function main() {
  outer.hits = 50;
  console.log(JSON.stringify([said, quiet, loud, calm, one, three, four, off, on, keyed, table, table.a === table.a]));
  console.log(JSON.stringify([a, b, c === a, d, registry.length, e, f, g, h, i, j, k, l.kept === a, (m as any).label, (fresh as any).label, n === fresh]));
}
main();
