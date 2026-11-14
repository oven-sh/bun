// Several kinds of sources take turns at one literal, and between the turns one of them changes: a value of another kind in a typed field, a name more, a name less, a getter, a name that is not listed,
// a frozen source, another prototype, numbers as names, the order of its names turned round. Every copy is held against plain Bun's.
interface Sheet { f0?: number; f1?: number; f2?: number; f3?: number; f4?: number; f5?: number; f6?: number; f7?: number; f8?: number; f9?: number; f10?: number; f11?: number; f12?: number; f13?: number; f14?: number; f15?: number; f16?: number; f17?: number; f18?: number; f19?: number; f20?: number; f21?: number; f22?: number; f23?: number; f24?: number; f25?: number; f26?: number; f27?: number; f28?: number; f29?: number; f30?: number; f31?: number; f32?: number; f33?: number; f34?: number; f35?: number; f36?: number; f37?: number; f38?: number; f39?: number; f40?: number; f41?: number; f42?: number; f43?: number; f44?: number; f45?: number; f46?: number; f47?: number; f48?: number; f49?: number; f50?: number; f51?: number; f52?: number; f53?: number; f54?: number; f55?: number; f56?: number; f57?: number; f58?: number; f59?: number; f60?: number; f61?: number; f62?: number; f63?: number; tick?: number }
interface Other { f0?: number; f1?: number; f2?: number; f3?: number; f4?: number; f5?: number; f6?: number; f7?: number; f8?: number; f9?: number; f10?: number; f11?: number; f12?: number; f13?: number; f14?: number; f15?: number; f16?: number; f17?: number; f18?: number; f19?: number; f20?: number; f21?: number; f22?: number; f23?: number; g0?: number; g1?: number; g2?: number; g3?: number; g4?: number; g5?: number; g6?: number; g7?: number; }
function next(s: Sheet, t: number): Sheet { return { ...s, tick: t }; }
function both(s: Sheet, o: Sheet, t: number): Sheet { return { ...s, ...o, tick: t }; }
function nameFirst(s: Sheet, o: Sheet, t: number): Sheet { return { tick: t, ...s, ...o }; }
(globalThis as any).kept = [next, both, nameFirst];
const show = (o: any) => JSON.stringify(Reflect.ownKeys(o).map(k => [String(k), typeof o[k] === "object" && o[k] ? JSON.stringify(o[k]) : String(o[k]), Object.getOwnPropertyDescriptor(o, k)!.enumerable, Object.getOwnPropertyDescriptor(o, k)!.writable]));
const other = (): Other => ({ f0: 1, f1: 2, f2: 3, g0: 4, g1: 5 });
const sheet = (): Sheet => ({ f0: 10, f7: 70, f40: 400 });
let asked = 0;
const makers: (() => any)[] = [
  () => Object.assign(other(), { own: 1, shared: "s" }),
  () => Object.assign(other(), { another: 2, shared: "s" }),
  () => JSON.parse('{"f0":1,"f5":2,"parsed":3,"last":[4]}'),
  () => JSON.parse('{"last":[4],"parsed":3,"f5":2,"f0":1}'),
  () => Object.assign(sheet(), { own: 1 }),
  () => sheet(),
];
const changes: [string, (m: any) => void][] = [
  ["nothing", () => {}],
  ["a text in a field of numbers", m => { m.f0 = "text"; }],
  ["undefined in a field", m => { m.f0 = undefined; }],
  ["a name more", m => { m.more = 1; }],
  ["a name less", m => { delete m.shared; delete m.parsed; delete m.f7; }],
  ["a field less", m => { delete m.f0; }],
  ["a field less and laid again", m => { delete m.f0; m.f0 = 5; }],
  ["a getter", m => { Object.defineProperty(m, "got", { get() { return ++asked; }, enumerable: true, configurable: true }); }],
  ["a getter in the place of a field", m => { Object.defineProperty(m, "f0", { get() { return ++asked; }, enumerable: true, configurable: true }); }],
  ["a name that is not listed", m => { Object.defineProperty(m, "unseen", { value: 1, enumerable: false, writable: true, configurable: true }); }],
  ["a field that is not listed", m => { Object.defineProperty(m, "f0", { value: 1, enumerable: false, writable: true, configurable: true }); }],
  ["frozen", m => { Object.freeze(m); }],
  ["another prototype", m => { Object.setPrototypeOf(m, { inherited: 1 }); }],
  ["numbers as names", m => { m[2] = "two"; m[0] = "zero"; }],
  ["a symbol", m => { m[Symbol.for("mark")] = 1; }],
  ["tick as its own name", m => { m.tick = -1; }],
  ["many names", m => { for (let i = 0; i < 70; i++) m["n" + i] = i; }],
];
for (const [name, change] of changes) {
  const sources = makers.map(make => make());
  const said: string[] = [];
  for (let t = 0; t < 144; t++) {
    if (t === 72) for (const source of sources) change(source);
    const s = sources[t % 6], o = sources[(t + 1 + (t / 6 | 0)) % 6];
    const line = show(next(s, 0)) + show(both(s, o, 0)) + show(nameFirst(s, o, 0));
    if (!said.includes(line)) said.push(line);
  }
  console.log(name, said.length, asked);
  for (const line of said) console.log(" ", line);
}
export {};
