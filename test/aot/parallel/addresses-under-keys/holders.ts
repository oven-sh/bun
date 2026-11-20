// Loops that read and store under keys that only the run knows: objects of every kind, aliases, accessors, frozen and deleted properties, prototypes, cells and numbers.
// STATISTIC: KeyedAddressesHoisted >= 15
let sink: any = 0;
const hard = JSON.parse('{"k":"k","j":"j"}');
const list: number[] = JSON.parse("[" + Array.from({ length: 20 }, (_, i) => (i * 37) % 11).join() + "]");
class Counter { k = 0; j = 1; step() { return this.k; } }
class Named { [hard.k] = 1; n = 2; }
function large(): any { const o: any = {}; for (let i = 0; i < 80; i++) o["f" + i] = i; o.k = 1; return o; }
function deleted(): any { const o: any = { k: 1, j: 2, z: 3 }; delete o.z; return o; }
function show(v: any, depth = 0): string {
  if (typeof v === "function") return "function";
  if (v === null || typeof v !== "object") return Object.is(v, -0) ? "-0" : typeof v + ":" + String(v);
  if (depth > 1 || v === globalThis) return "..";
  return "{" + Reflect.ownKeys(v).slice(0, 9).map(k => { const d = Object.getOwnPropertyDescriptor(v, k)!; return String(k) + (d.writable === false ? "!" : "") + ":" + ("value" in d ? show(d.value, depth + 1) : "accessor"); }).join() + "}";
}
function report(name: string, body: () => any): void {
  let said: string;
  try { said = show(body()); } catch (error) { said = (error as Error).name; }
  console.log(name, said, show(sink)); sink = 0; delete (globalThis as any).k; delete (globalThis as any).j;
}
let K: string = hard.k;
export function change(key: string): void { K = key; }
function use0(o: any, p: any, a: string, b: string): any { let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; o[a] = x; s = (s + x) | 0; } return [s, o, p]; }
function use1(o: any, p: any, a: string, b: string): any { let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; o[a] = (o[a] + x) & 1023; } return [s, o, p]; }
function use2(o: any, p: any, a: string, b: string): any { let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; o[a] += x; s += typeof o[a] === "number" ? o[a] : 1; } return [s, o, p]; }
function use3(o: any, p: any, a: string, b: string): any { let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; o[a]++; s = (s + (o[a] | 0)) | 0; } return [s, o, p]; }
function use4(o: any, p: any, a: string, b: string): any { let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; o[a] = x; s += String(o.k).length; p[b] = o[a]; } return [s, o, p]; }
function use5(o: any, p: any, a: string, b: string): any { let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; o[a] = { x }; s += x; } return [s, o, p]; }
function use6(o: any, p: any, a: string, b: string): any { let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; s = (s + o[a] + x) | 0; } return [s, o, p]; }
function use7(o: any, p: any, a: string, b: string): any { let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; o[a] = x; if (i === 5) delete o[a]; } return [s, o, p]; }
function use8(o: any, p: any, a: string, b: string): any { let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; o[a] = x; if (i === 5 && o && o !== globalThis) Object.freeze(o); } return [s, o, p]; }
function use9(o: any, p: any, a: string, b: string): any { let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; p[b] = x; s = (s + (o[a] | 0)) | 0; } return [s, o, p]; }
function use10(o: any, p: any, a: string, b: string): any { let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; o[a] = x * 0.5; s += o[a] as number; if (x === 10) o[b] = "text"; } return [s, o, p]; }
let module0: any; function read0(): any { const module = module0; let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; module[K] = x; s = (s + x) | 0; } return [s, module]; }
let module1: any; function read1(): any { const module = module1; let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; module[K] = (module[K] + x) & 1023; } return [s, module]; }
let module2: any; function read2(): any { const module = module2; let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; module[K] += x; s += typeof module[K] === "number" ? module[K] : 1; } return [s, module]; }
let module3: any; function read3(): any { const module = module3; let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; module[K]++; s = (s + (module[K] | 0)) | 0; } return [s, module]; }
let module4: any; function read4(): any { const module = module4; let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; module[K] = x; s += String(module.k).length; module["j"] = module[K]; } return [s, module]; }
let module5: any; function read5(): any { const module = module5; let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; module[K] = { x }; s += x; } return [s, module]; }
let module6: any; function read6(): any { const module = module6; let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; s = (s + module[K] + x) | 0; } return [s, module]; }
let module7: any; function read7(): any { const module = module7; let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; module[K] = x; if (i === 5) delete module[K]; } return [s, module]; }
let module8: any; function read8(): any { const module = module8; let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; module[K] = x; if (i === 5 && module && module !== globalThis) Object.freeze(module); } return [s, module]; }
let module9: any; function read9(): any { const module = module9; let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; module["j"] = x; s = (s + (module[K] | 0)) | 0; } return [s, module]; }
let module10: any; function read10(): any { const module = module10; let s = 0; for (let r = 0; r < 3; r++) for (let i = 0; i < list.length; i++) { const x = list[i]!; module[K] = x * 0.5; s += module[K] as number; if (x === 10) module["j"] = "text"; } return [s, module]; }
const holders: [string, () => any][] = [
  ["h0", () => ({ k: 0, j: 1 })],
  ["h1", () => ({ k: 1.5, j: 1, a: 2, b: 3, c: 4 })],
  ["h2", () => ({ k: "a", j: 1 })],
  ["h3", () => ({})],
  ["h4", () => JSON.parse('{"k":1,"j":2}')],
  ["h5", () => Object.create(null)],
  ["h6", () => Object.create({ k: 5 })],
  ["h7", () => Object.create({ get k() { return 3; }, set k(v: any) { sink = v; } })],
  ["h8", () => Object.freeze({ k: 1, j: 2 })],
  ["h9", () => Object.seal({ k: 1, j: 2 })],
  ["h10", () => Object.preventExtensions({ j: 1 })],
  ["h11", () => ({ get k() { return 7; }, set k(v: any) { sink = v; }, j: 1 })],
  ["h12", () => Object.defineProperty({ j: 1 }, "k", { value: 4, writable: false })],
  ["h13", () => [1, 2, 3]],
  ["h14", () => new Counter()],
  ["h15", () => new Named()],
  ["h16", () => new Map()],
  ["h17", () => new Proxy({ k: 1 }, {})],
  ["h18", () => new Uint8Array(4)],
  ["h19", () => globalThis],
  ["h20", () => Object.getPrototypeOf(Object.create({ k: 1, j: 2 }))],
  ["h21", () => large()],
  ["h22", () => deleted()],
  ["h23", () => Object.fromEntries([["k", 1], ["j", 2]])],
  ["h24", () => "text"],
  ["h25", () => null],
];
const uses: [(o: any, p: any, a: string, b: string) => any][] = [[use0], [use1], [use2], [use3], [use4], [use5], [use6], [use7], [use8], [use9], [use10]];
const reads: ((holder: any) => any)[] = [holder => { module0 = holder; return read0(); }, holder => { module1 = holder; return read1(); }, holder => { module2 = holder; return read2(); }, holder => { module3 = holder; return read3(); }, holder => { module4 = holder; return read4(); }, holder => { module5 = holder; return read5(); }, holder => { module6 = holder; return read6(); }, holder => { module7 = holder; return read7(); }, holder => { module8 = holder; return read8(); }, holder => { module9 = holder; return read9(); }, holder => { module10 = holder; return read10(); }];
for (const [name, make] of holders) {
  uses.forEach(([use], number) => {
    report(name + " " + number, () => use(make(), { j: 1 }, hard.k, hard.j));
    report(name + " same " + number, () => { const o = make(); return use(o, o, hard.k, hard.k); });
  });
  reads.forEach((read, number) => report(name + " module " + number, () => read(make())));
}
for (const key of [Symbol("y"), 1, "1", "", null, undefined, true, 1.5, "missing", "__proto__", { toString() { return "k"; } }] as any[])
  uses.forEach(([use], number) => report(String(typeof key === "symbol" ? "symbol" : key) + " " + number, () => use({ k: 1, j: 2 }, {}, key, "j")));
change(hard.j);
reads.forEach((read, number) => report("changed " + number, () => read({ k: 0, j: 1 })));
