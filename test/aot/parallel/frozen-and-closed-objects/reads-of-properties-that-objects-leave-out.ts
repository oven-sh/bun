// `o.x` with x?: the slot may be empty, and then the answer is whatever stands elsewhere in the object or above it.
class Options { name: string; declare limit?: number; declare label?: string; declare next?: Options; constructor(name: string) { this.name = name; } }
class Derived extends Options { declare extra?: number; }
function Old(this: any, name: string) { this.name = name; }
interface OldObject { name: string; limit?: number; label?: string }
type Literal = { name: string; limit?: number; label?: string };
let log = "";
const sink: unknown[] = []; (globalThis as any).sinkOfReads = sink;
function escape<T>(o: T): T { sink.push(o); sink.length = 0; return o; }

function one(o: Options): unknown { return o.limit; }
function two(o: Options): string { return o.limit + "," + o.label; }
function three(o: Options): string { return o.name + "," + o.limit + "," + o.label + "," + (o.next === undefined); }
function derived(o: Derived): string { return o.extra + "," + o.limit; }
function old(o: OldObject): string { return o.limit + "," + o.label; }
function literal(o: Literal): string { return o.limit + "," + o.label; }
function inLoop(o: Options, n: number): string { let s = ""; for (let i = 0; i < n; i++) s += o.limit + "," + o.label + ";"; return s; }
function around(o: Options, hook: (o: object) => void): string { const a = o.limit + "," + o.label; hook(o); return a + "|" + o.limit + "," + o.label; }
function aroundInLoop(o: Options, hook: (o: object) => void, at: number): string { let s = ""; for (let i = 0; i < 4; i++) { s += o.limit + ","; if (i === at) hook(o); s += o.label + ";"; } return s; }
function chain(o: Options): string { return String(o.next?.limit) + "," + String(o.next?.next?.label); }
function withDefault(o: Options): number { return (o.limit ?? 10) + (o.label === undefined ? 1 : 2); }
function readAndStore(o: Options, v: number): string { const before = o.limit; o.limit = v; return before + "," + o.limit + "," + o.label; }

const make = [() => new Options("a"), () => { const o = new Options("b"); o.limit = 1; return o; }, () => { const o = new Options("c"); o.label = "l"; o.limit = 2; return o; }, () => { const o = new Options("d"); o.next = new Options("e"); o.next.limit = 3; return o; }];
for (let i = 0; i < 40; i++) for (const m of make) { const o = escape(m()); one(o); two(o); three(o); inLoop(o, 2); around(o, () => { }); aroundInLoop(o, () => { }, 1); chain(o); withDefault(o); readAndStore(m(), i); derived(escape(new Derived("x"))); old(escape(new (Old as any)("o"))); literal(escape({ name: "n" })); }
for (const m of make) console.log(one(m()), two(m()), three(m()), inLoop(m(), 2), chain(m()), withDefault(m()), readAndStore(m(), 9));
console.log(derived(new Derived("x")), old(new (Old as any)("o")), literal({ name: "n" }), literal({ name: "n", label: "z" }));

const hooks: ((o: any) => void)[] = [
  o => { o.limit = 5; }, o => { o.label = "set"; }, o => { delete o.limit; delete o.label; },
  o => { Object.defineProperty(o, "limit", { get() { log += "g"; return 77; }, configurable: true }); },
  o => { Object.defineProperty(o, "label", { value: "fixed", writable: false, enumerable: false, configurable: true }); },
  o => { Object.setPrototypeOf(o, { limit: 88, get label() { log += "p"; return "proto"; } }); },
  o => { Object.setPrototypeOf(o, null); }, o => { Object.freeze(o); }, o => { Object.seal(o); }, o => { o.other = 1; },
  o => { o.limit = "text"; }, o => { o.limit = undefined; o.label = undefined; },
];
for (const hook of hooks) for (const m of make.slice(0, 3)) { log = ""; console.log(around(m(), hook), aroundInLoop(m(), hook, 0), aroundInLoop(m(), hook, 2), (() => { const o = m(); hook(o); return two(o) + "/" + three(o) + "/" + inLoop(o, 2) + "/" + withDefault(o); })(), log); }
for (const close of [Object.freeze, Object.seal, Object.preventExtensions]) console.log(two(close(make[0]())), two(close(make[2]())), inLoop(close(make[1]()), 2));

for (const [holder, who] of [[Options.prototype, "Options"], [Derived.prototype, "Derived"], [Old.prototype, "Old"]] as [any, string][]) {
  for (const descriptor of [{ value: 99, writable: true, configurable: true }, { get() { log += "G"; return 98; }, set(v: unknown) { log += "S"; }, configurable: true }]) {
    Object.defineProperty(holder, "limit", descriptor); log = "";
    console.log(who, one(make[0]()), two(make[0]()), two(make[1]()), derived(new Derived("x")), old(new (Old as any)("o")), literal({ name: "n" }), inLoop(make[0](), 2), withDefault(make[0]()), log);
    delete holder.limit; log = "";
    console.log(who, one(make[0]()), two(make[0]()), derived(new Derived("x")), old(new (Old as any)("o")), literal({ name: "n" }), log);
  }
}
Object.setPrototypeOf(Options.prototype, { label: "far above" });
console.log(two(make[0]()), derived(new Derived("x")), inLoop(make[0](), 1));
