// Accesses by name of holders that no literal and no class of the program names, in loops that store into them: parsed objects whose state changes at run time.
// @ts-nocheck
const ints: number[] = JSON.parse("[" + Array.from({ length: 12 }, (_, k) => (k * 37) % 23).join() + "]"), halves: number[] = ints.map(x => x / 2), odd: number[] = JSON.parse('[1,2,"a",4,null,6,7.5,-0,2147483647,1,2,3]');
let reads = 0, writes = 0; const texts = ["a", "bb"]; let sink: any = 0;
function show(o: any): string { if (o === null || typeof o !== "object") return String(o); try { return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k)!; return String(k) + ":" + ("value" in d ? Object.is(d.value, -0) ? "-0" : typeof d.value + String(d.value) : "acc") + (d.writable === false ? "!" : ""); }).join(); } catch (e: any) { return e.name; } }
const parse = (): any => JSON.parse('{"za":0,"zb":1.5,"zc":"t","zd":null}');
const A: any = parse(), B: any = parse(), C: any = Object.assign({}, parse()); let D: any = parse();
const HANDLER = { get(t: any, k: any) { reads++; return Reflect.get(t, k); }, set(t: any, k: any, v: any) { writes++; return Reflect.set(t, k, v); } };
const STATES: Record<string, (o: any) => void> = {
  plain() {}, frozen(o) { Object.freeze(o); }, sealed(o) { Object.seal(o); }, gone(o) { Reflect.deleteProperty(o, "za"); Reflect.deleteProperty(o, "zb"); }, more(o) { for (let k = 0; k < 70; k++) o["m" + k] = k; },
  accessor(o) { Object.defineProperty(o, "za", { get() { reads++; return 7; }, set(v) { writes++; sink = v; }, configurable: true }); }, fixed(o) { Object.defineProperty(o, "za", { value: 4, writable: false, configurable: true }); },
  above(o) { Reflect.deleteProperty(o, "za"); Object.setPrototypeOf(o, Object.create({}, { za: { get() { reads++; return 3; }, set(v) { writes++; sink = v; }, configurable: true } })); },
  proxied(o) { Reflect.deleteProperty(o, "za"); Object.setPrototypeOf(o, new Proxy({}, HANDLER)); }, order(o) { const v = o["za"]; Reflect.deleteProperty(o, "za"); o["ze"] = 1; o["za"] = v; }, none(o) { Object.setPrototypeOf(o, null); }, texts(o) { o["za"] = "s"; o["zb"] = {}; },
};
function f0(of: number[], n: number, o: any) { let s: any = 0; for (let r = 0; r < n; r++) for (let i = 0; i < of.length; i++) { const x = of[i]!; { if (x > 9) { if (i === 7) delete o.za; } } s = (s + x) | 0; } return s; }
function f1(of: number[], n: number, o: any) { let s: any = 0; for (let r = 0; r < n; r++) for (let i = 0; i < of.length; i++) { const x = of[i]!; C.za++; s = (s + A.zc) | 0; A["z" + "a"] = x; s = (s + x) | 0; } return s; }
function f2(of: number[], n: number, o: any) { let s: any = 0; for (let r = 0; r < n; r++) for (let i = 0; i < of.length; i++) { const x = of[i]!; { B.za ??= x; } s += x; } return s; }
function f3(of: number[], n: number, o: any) { let s: any = 0; for (let r = 0; r < n; r++) for (let i = 0; i < of.length; i++) { const x = of[i]!; { if (x > B.za) B.za = x; } if (i === 7) delete A.za;  } return s; }
function f4(of: number[], n: number, o: any) { let s: any = 0; for (let r = 0; r < n; r++) for (let i = 0; i < of.length; i++) { const x = of[i]!; A.ze ??= x;  } return s; }
function f5(of: number[], n: number, o: any) { let s: any = 0; for (let r = 0; r < n; r++) for (let i = 0; i < of.length; i++) { const x = of[i]!; try { if (x > 9) { if (x > o.zc) o.zc = x; } } catch { s++; }  } return s; }
const start = [A, B, C, D].map(o => Object.getPrototypeOf(o));
function again(o: any, k: number): any { return parse(); }
for (const state of Object.keys(STATES)) for (const f of [f0, f1, f2, f3, f4, f5]) for (const [name, of] of [["ints", ints], ["halves", halves], ["odd", odd]] as [string, number[]][]) {
  for (const o of [A, B, C]) { if (Object.isExtensible(o)) { for (const k of Reflect.ownKeys(o)) Reflect.deleteProperty(o, k); Object.setPrototypeOf(o, Object.prototype); Object.assign(o, parse()); } }
  D = parse(); reads = writes = 0; sink = 0; const given = parse(); if (state !== "frozen" && state !== "sealed") { STATES[state]!(A); STATES[state]!(given); } else STATES[state]!(given);
  let r: unknown; try { r = f(of, 2, given); } catch (e: any) { r = e.name; }
  console.log(state, f.name, name, String(r), show(A), show(B), show(C), show(D), show(given), reads, writes, show(sink));
}
