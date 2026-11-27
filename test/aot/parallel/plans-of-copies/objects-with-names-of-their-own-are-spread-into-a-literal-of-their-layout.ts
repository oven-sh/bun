// An object of a literal's own layout that bears names beside that layout is spread into the literal again: the fields go as words and the other names as a copy of their own: nothing is shared with the source,
// the order of keys stays, getters run once a copy, what is not listed stays behind, and a frozen source gives a copy that is not frozen.
interface Wide { f0?: number; f1?: number; f2?: number; f3?: number; f4?: number; f5?: number; f6?: number; f7?: number; f8?: number; f9?: number; f10?: number; f11?: number; f12?: number; f13?: number; f14?: number; f15?: number; f16?: number; f17?: number; f18?: number; f19?: number; f20?: number; f21?: number; f22?: number; f23?: number; f24?: number; f25?: number; f26?: number; f27?: number; f28?: number; f29?: number; f30?: number; f31?: number; f32?: number; f33?: number; f34?: number; f35?: number; f36?: number; f37?: number; f38?: number; f39?: number; tick?: number }
interface Small { a?: number; b?: string; tick?: number }

const make = (): Wide => ({ f0: 1, f2: 3, f4: 5, f6: 7, f8: 9, f10: 11, f12: 13, f14: 15, f16: 17, f18: 19, f20: 21, f22: 23, f24: 25, f26: 27, f28: 29, f30: 31, f32: 33, f34: 35, f36: 37, f38: 39 });
const makeSmall = (): Small => ({ a: 1, b: "two" });
function step(m: Wide, t: number): Wide { return { ...m, tick: t }; }
function stepSmall(m: Small, t: number): Small { return { ...m, tick: t }; }
function nameFirst(m: Wide, t: number): Wide { return { tick: t, ...m }; }
function twice(m: Wide, o: Wide): Wide { return { ...m, ...o }; }
(globalThis as any).kept = [step, stepSmall, nameFirst, twice];
const show = (o: any) => JSON.stringify(Reflect.ownKeys(o).map(k => [String(k), typeof o[k] === "object" && o[k] ? "object" : String(o[k]), Object.getOwnPropertyDescriptor(o, k)!.enumerable, Object.getOwnPropertyDescriptor(o, k)!.writable, Object.getOwnPropertyDescriptor(o, k)!.configurable]));
let asked = 0;
const mark = Symbol("mark"), hidden = Symbol("hidden");
const kinds: [string, (m: any) => any][] = [
  ["plain names", m => Object.assign(m, JSON.parse('{"own1":1,"own2":"two","own3":null}'))],
  ["one name", m => { m.own = 7; return m; }],
  ["a getter that counts", m => Object.defineProperty(m, "got", { get() { asked++; return asked; }, enumerable: true, configurable: true })],
  ["a name that is not listed", m => Object.defineProperty(Object.assign(m, { seen: 1 }), "unseen", { value: 2, enumerable: false, writable: true, configurable: true })],
  ["a name that cannot be written", m => Object.defineProperty(m, "fixed", { value: 3, enumerable: true, writable: false, configurable: false })],
  ["symbols", m => { m[mark] = 4; Object.defineProperty(m, hidden, { value: 5, enumerable: false }); m.after = 6; return m; }],
  ["numbers as names", m => { m[3] = "three"; m.between = 1; m[1] = "one"; return m; }],
  ["__proto__ as its own name", m => Object.defineProperty(m, "__proto__", { value: 8, enumerable: true, writable: true, configurable: true })],
  ["frozen", m => Object.freeze(Object.assign(m, { own: 1 }))],
  ["sealed", m => Object.seal(Object.assign(m, { own: 1 }))],
  ["a name taken away again", m => { m.gone = 1; m.stays = 2; delete m.gone; return m; }],
  ["a field taken away and a name added", m => { delete m.f2; delete m.a; m.own = 1; return m; }],
  ["a field taken away and laid again behind a name", m => { delete m.f4; delete m.b; m.own = 1; m.f4 = 44; m.b = "again"; return m; }],
  ["another prototype", m => Object.setPrototypeOf(Object.assign(m, { own: 1 }), { inherited: 9 })],
  ["no prototype", m => Object.setPrototypeOf(Object.assign(m, { own: 1 }), null)],
  ["many names", m => { for (let i = 0; i < 90; i++) m["n" + i] = i; return m; }],
  ["many names, some taken away", m => { for (let i = 0; i < 90; i++) m["n" + i] = i; for (let i = 0; i < 90; i += 3) delete m["n" + i]; return m; }],
  ["an object under a name", m => { m.held = { deep: 1 }; return m; }],
  ["tick as its own name already", m => { m.own = 1; m.tick = -1; return m; }],
];
const n = +(process.argv[2] ?? 6);
for (const [name, dress] of kinds) {
  for (const [label, born, go] of [["wide", make, step], ["small", makeSmall, stepSmall], ["name first", make, nameFirst]] as [string, () => any, (m: any, t: number) => any][]) {
    const source = dress(born());
    const before = show(source);
    let last: any, said = new Set<string>();
    for (let t = 0; t < n; t++) { last = go(source, t); said.add(show({ ...last, tick: 0 })); }
    const again = go(last, 99);
    for (const key of Reflect.ownKeys(last)) { try { last[key] = "changed"; } catch {} }
    last.added = 1;
    console.log(name, "|", label, "|", said.size, [...said][0], "| its own copy", show(again), "| the source stays", before === show(source), Object.isFrozen(again), Object.isSealed(again), Object.getPrototypeOf(again) === Object.prototype, asked);
  }
  const both = twice(dress(make()), dress(make()));
  console.log(name, "| two |", show(both));
}
export {};
