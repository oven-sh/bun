// Fields that begin as written constants and change later, by every road.
type Opt = { size: number; deep: boolean };
function make(size: number): Opt { return { size, deep: true }; }
const A: Opt = { size: 4, deep: true };
const list: Opt[] = [A, make(5), { size: 4, deep: true }];
function total(o: Opt[]): number { let s = 0; for (const x of o) s = s * 10 + x.size + (x.deep ? 1 : 0); return s; }
console.log(total(list), A.size, list[1]!.size, list[2]!.size);
list[2]!.size = 8;
console.log(total(list), A.size, list[2]!.size);
class Box<T> { constructor(public value: T) {} }
const boxed = new Box({ size: 3, deep: false }); const other = new Box({ size: 3, deep: false }); (other.value as any)["si" + "ze"] = 6;
console.log(boxed.value.size, other.value.size, boxed.value.deep);
function option(o: Partial<Opt> = {}): Opt { const r = { size: 1, deep: false, ...o }; return r; }
console.log(option().size, option({ size: 2 }).size, option({ deep: true }).deep);
const defaults = { retries: 3, verbose: false, name: "x" };
function configure(o: Partial<typeof defaults>): typeof defaults { return Object.assign(defaults, o); }
function read(): string { return `${defaults.retries} ${defaults.verbose} ${defaults.name}`; }
console.log(read()); configure({ retries: 5 }); console.log(read()); configure({ verbose: true, name: "y" }); console.log(read());
const state = { count: 0, done: false }; function tick(): void { state.count++; if (state.count > 2) state.done = true; }
for (let i = 0; i < 4; i++) { tick(); console.log(state.count, state.done); }
const flags = { debug: false }; export function setDebug(x: boolean): void { flags.debug = x; } function dbg(): string { return flags.debug ? "debug" : "quiet"; }
console.log(dbg()); setDebug(true); console.log(dbg());
let cfg = { level: 1 }; function level(): number { return cfg.level; } console.log(level()); cfg = { level: 2 }; console.log(level()); cfg = JSON.parse('{"level":3}'); console.log(level());
const tree = { left: { v: 1 }, right: { v: 2 } }; const swap = tree.left; tree.left = tree.right; tree.right = swap; function lv(): number { return tree.left.v * 10 + tree.right.v; } console.log(lv());
const frozen = Object.freeze({ k: 1, n: { m: 2 } }); try { (frozen as any).k = 5; } catch (e: any) { console.log(e.name); } (frozen as any).n.m = 7; function fr(): number { return frozen.k * 10 + frozen.n.m; } console.log(fr());
const acc = { get a() { return 5; }, b: 6 }; Object.defineProperty(acc, "b", { get: () => 8 }); function ac(): number { return acc.a * 10 + acc.b; } console.log(ac());
const del: { a?: number; b: number } = { a: 1, b: 2 }; function rd(): string { return String(del.a) + del.b; } console.log(rd()); delete del.a; console.log(rd());
const proto = { p: 1 }; const heir = Object.create(proto); function hp(): number { return heir.p; } console.log(hp()); proto.p = 2; console.log(hp()); heir.p = 3; console.log(hp(), proto.p);
