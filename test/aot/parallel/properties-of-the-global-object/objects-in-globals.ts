// @ts-nocheck
const xs: number[] = JSON.parse("[" + Array.from({ length: 16 }, (_, k) => (k * 37) % 11).join() + "]");
const g: any = globalThis;
const SYM = Symbol.for("gl4.app");
class Counter { n = 0; hit(x: number) { this.n += x; return this.n & 7; } get twice() { return this.n * 2; } }
class Other { n = 1; hit(x: number) { this.n -= x; return this.n; } }
let calls = 0;
function text(v: any): string { if (typeof v === "function") return "fn:" + v.name; if (v instanceof Map) return "M" + [...v].join(";"); return v && typeof v === "object" ? JSON.stringify(v) : String(v); }
function show(name: string, names: any[], run: (round: number) => unknown): void {
  const said: string[] = [];
  for (let round = 0; round < 4; round++) { try { said.push(String(run(round))); } catch (error) { said.push((error as Error).name); } said.push(names.map(k => { try { return text(g[k]); } catch (e) { return "!"; } }).join()); }
  console.log(name, said.join(" "), calls);
}
(globalThis as any).w0 = [];
function f0(round: number) {  if (round === 2) { g[["", "w0"].filter(Boolean)[0]] = undefined; } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; s += (globalThis as any).w0.map((y: any) => y).length; if (i === 0 && round === 1) { g[["", "w0"].filter(Boolean)[0]] = undefined; } } return s; }
show("f0", ["w0"], f0);

function f1(round: number) { if (round === 0) { (globalThis as any).w1 ??= (x: number) => x + 1; }  let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (i === 1 && round === 3) { (globalThis as any).w1 = Object.create({ total: 3, hit: (x: any) => x }); } s += (globalThis as any).w1.call(null, x); s += (globalThis as any).w1.length; } return s; }
show("f1", ["w1"], f1);
globalThis["w2"] = (x: number) => x + 1;
function f2(round: number) {   let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (i === 5 && round === 0) { Object.defineProperty(g, "w2", { configurable: true, enumerable: true, writable: true, value: 7 }); } s += globalThis["w2"].call(null, x); s = (s + globalThis["w2"](x)) | 0; s += globalThis["w2"]?.(x); } return s; }
show("f2", ["w2"], f2);
g.w3 = { a: { b: 1 }, f(x: number) { return x + this.a.b; } };
function f3(round: number) {  if (round === 2) { delete g["w3"]; } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; g.w3.a.b++; g.w3.a.b++; s += g.w3.f(x); } return s; }
show("f3", ["w3"], f3);
g.w4 ??= Object.freeze({ total: 1, calls: 1 });
function f4(round: number) {  if (round === 2) { g.w4 = ["p", "q"]; } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (g.w4.calls) s++; g.w4.total += x; s = (s + x) | 0; if (i === 8 && round === 2) { g.w4 = ["p", "q"]; } g.w4.calls++; } return s; }
show("f4", ["w4"], f4);
g.w5 = new Map();
function f5(round: number) {  if (round === 2) { g.w5 = new Map([[3, 4]]); } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; g.w5.set(x, i); s += g.w5.size; if (i === 3 && round === 0) { g.w5 = new Map([[3, 4]]); } } return s; }
show("f5", ["w5"], f5);
g.w6 ||= { total: 0.5, calls: 1, more: "x" };
function f6(round: number) {   let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (i === 1 && round === 1) { Object.defineProperty(g, "w6", { configurable: true, enumerable: true, get: () => (calls++, [9, 8]), set: () => { calls += 100; } }); } g.w6.total += x; s = (s + x) | 0; } return s; }
show("f6", ["w6"], f6);

function f7(round: number) { if (round === 0) { (globalThis as any).w7 ||= new Map([[1, 2]]); }  let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (i === 3 && round === 0) { g[["", "w7"].filter(Boolean)[0]] = Object.create({ total: 3, hit: (x: any) => x }); } s = (s + ((globalThis as any).w7.get(x) ?? 0)) | 0; s += (globalThis as any).w7.has(x) ? 1 : 0; } return s; }
show("f7", ["w7"], f7);

function f8(round: number) { if (round === 0) { g.w8 ??= new Other(); }  let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (i === 6 && round === 2) { g.w8 = Object.assign(() => 4, { total: 1, calls: 2 }); } s += g.w8 instanceof Counter ? 1 : 2; s = (s + g.w8.hit(x)) | 0; } return s; }
show("f8", ["w8"], f8);
g[SYM] = new Map();
function f9(round: number) {  if (round === 2) { Reflect.set(g, SYM, [9, 8]); } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (i === 2 && round === 0) { Reflect.set(g, SYM, [9, 8]); } g[SYM].set(x, i); s += g[SYM].has(x) ? 1 : 0; } return s; }
show("f9", [SYM], f9);
g[SYM] ||= function add(x: number) { calls++; return x * 2; };
function f10(round: number) {   let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (i === 8 && round === 0) { Object.defineProperty(g, SYM, { configurable: true, enumerable: true, get: () => (calls++, undefined), set: () => { calls += 100; } }); } s += g[SYM].length; } return s; }
show("f10", [SYM], f10);

function f11(round: number) { if (round === 0) { g.w11 ||= new Map(); }  let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (i === 12 && round === 1) { delete g["w11"]; } s = (s + (g.w11.get(x) ?? 0)) | 0; s = (s + (g.w11.get(x) ?? 0)) | 0; g.w11.set(x, i); } return s; }
show("f11", ["w11"], f11);
g.w12 = new Other();
function f12(round: number) {  if (round === 2) { delete g["w12"]; } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; s += g.w12 instanceof Counter ? 1 : 2; if (i === 1 && round === 2) { delete g["w12"]; } s += g.w12.twice ?? 0; } return s; }
show("f12", ["w12"], f12);

function f13(round: number) { if (round === 0) { g.w13 ??= Object.freeze({ total: 1, calls: 1 }); } if (round === 2) { Object.defineProperty(g, "w13", { configurable: true, enumerable: true, writable: true, value: "text" }); } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (i === 10 && round === 1) { Object.defineProperty(g, "w13", { configurable: true, enumerable: true, writable: true, value: "text" }); } s = (s + g.w13.total) | 0; } return s; }
show("f13", ["w13"], f13);

function f14(round: number) { if (round === 0) { g.w14 ??= new Map([[1, 2]]); } if (round === 2) { g.w14 = new Other(); } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (i === 2 && round === 2) { g.w14 = new Other(); } g.w14.set(x, i); s += g.w14.size; s += g.w14.has(x) ? 1 : 0; } return s; }
show("f14", ["w14"], f14);

function f15(round: number) { if (round === 0) { (globalThis as any).w15 ||= { total: 0, calls: 1 }; }  let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; (globalThis as any).w15.calls++; if (i === 0 && round === 2) { Object.defineProperty(g, "w15", { configurable: true, enumerable: true, get: () => (calls++, new Proxy({}, { get: (t, k) => (calls++, 1), set: () => (calls++, true) })), set: () => { calls += 100; } }); } } return s; }
show("f15", ["w15"], f15);

function f16(round: number) { if (round === 0) { g.w16 ||= [1, 2, 3]; } if (round === 2) { Object.defineProperty(g, "w16", { configurable: true, enumerable: true, get: () => (calls++, new Proxy({}, { get: (t, k) => (calls++, 1), set: () => (calls++, true) })), set: () => { calls += 100; } }); } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; g.w16[i & 3] = x; if (i === 9 && round === 0) { Object.defineProperty(g, "w16", { configurable: true, enumerable: true, get: () => (calls++, new Proxy({}, { get: (t, k) => (calls++, 1), set: () => (calls++, true) })), set: () => { calls += 100; } }); } } return s; }
show("f16", ["w16"], f16);
g.w17 ||= Object.freeze({ total: 1, calls: 1 });
function f17(round: number) {  if (round === 2) { g[["", "w17"].filter(Boolean)[0]] = ["p", "q"]; } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; s += g.w17.total; delete g.w17.calls; } return s; }
show("f17", ["w17"], f17);

function f18(round: number) { if (round === 0) { g.w18 = new Map([[1, 2]]); } if (round === 2) { delete g["w18"]; } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; s += g.w18.has(x) ? 1 : 0; s += g.w18.has(x) ? 1 : 0; s = (s + (g.w18.get(x) ?? 0)) | 0; } return s; }
show("f18", ["w18"], f18);
g.w19 = { a: { b: "t" }, f: (x: any) => x };
function f19(round: number) {   let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; g.w19.a = { b: x }; g.w19.a.b++; s = (s + g.w19.a.b) | 0; } return s; }
show("f19", ["w19"], f19);

function f20(round: number) { if (round === 0) { g.w20 ||= { a: { b: 1 }, f(x: number) { return x + this.a.b; } }; } if (round === 2) { g["w20"] = Object.create({ total: 3, hit: (x: any) => x }); } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (i === 1 && round === 3) { g["w20"] = Object.create({ total: 3, hit: (x: any) => x }); } s = (s + g.w20.a.b) | 0; } return s; }
show("f20", ["w20"], f20);

function f21(round: number) { if (round === 0) { (globalThis as any).w21 = Object.freeze({ total: 1, calls: 1 }); } if (round === 2) { (globalThis as any).w21 = new Map([[3, 4]]); } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if ((globalThis as any).w21.calls) s++; if ((globalThis as any).w21.calls) s++; delete (globalThis as any).w21.calls; } return s; }
show("f21", ["w21"], f21);
globalThis["w22"] = { total: 0.5, calls: 1, more: "x" };
function f22(round: number) {  if (round === 2) { delete g["w22"]; } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (i === 4 && round === 1) { delete g["w22"]; } if (globalThis["w22"].calls) s++; s += globalThis["w22"].total; } return s; }
show("f22", ["w22"], f22);
g.w23 = { total: 0.5, calls: 1, more: "x" };
function f23(round: number) {   let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; g.w23.more = x; if (i === 5 && round === 0) { Object.defineProperty(g, "w23", { configurable: true, enumerable: true, writable: true, value: Object.create({ total: 3, hit: (x: any) => x }) }); } } return s; }
show("f23", ["w23"], f23);
g.w24 = [];
function f24(round: number) {   let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; g.w24.push(x); if (i === 6 && round === 2) { Object.defineProperty(g, "w24", { configurable: true, enumerable: true, get: () => (calls++, { a: { b: 2.5 }, f: 5 }), set: () => { calls += 100; } }); } g.w24.push(x); } return s; }
show("f24", ["w24"], f24);
g.w25 ||= function add(x: number) { calls++; return x * 2; };
function f25(round: number) {  if (round === 2) { Object.defineProperty(g, "w25", { configurable: true, enumerable: true, get: () => (calls++, new Other()), set: () => { calls += 100; } }); } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; s += g.w25.length; } return s; }
show("f25", ["w25"], f25);

function f26(round: number) { if (round === 0) { g.w26 ||= { total: 0.5, calls: 1, more: "x" }; }  let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; delete g.w26.calls; if (g.w26.calls) s++; s = (s + g.w26.total) | 0; } return s; }
show("f26", ["w26"], f26);

function f27(round: number) { if (round === 0) { g[SYM] ??= { total: 0, calls: 1 }; } if (round === 2) { Object.defineProperty(g, SYM, { configurable: true, enumerable: true, writable: true, value: 7 }); } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (i === 9 && round === 2) { Object.defineProperty(g, SYM, { configurable: true, enumerable: true, writable: true, value: 7 }); } g[SYM].total += x; s = (s + x) | 0; } return s; }
show("f27", [SYM], f27);
(globalThis as any).w28 ||= function add(x: number) { calls++; return x * 2; };
function f28(round: number) {  if (round === 2) { g[["", "w28"].filter(Boolean)[0]] = (y: any) => "r" + y; } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (i === 7 && round === 1) { g[["", "w28"].filter(Boolean)[0]] = (y: any) => "r" + y; } s += (globalThis as any).w28?.(x); s += (globalThis as any).w28.call(null, x); s += (globalThis as any).w28.call(null, x); } return s; }
show("f28", ["w28"], f28);

function f29(round: number) { if (round === 0) { g.w29 ||= Object.freeze({ total: 1, calls: 1 }); }  let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (i === 3 && round === 0) { g.w29 = (y: any) => "r" + y; } g.w29.total += x; s = (s + x) | 0; } return s; }
show("f29", ["w29"], f29);
g[SYM] ||= { total: 0.5, calls: 1, more: "x" };
function f30(round: number) {  if (round === 2) { Reflect.set(g, SYM, { get total() { calls++; return 2; }, set total(v) { calls += 10; }, calls: 0 }); } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (g[SYM].calls) s++; if (i === 10 && round === 0) { Reflect.set(g, SYM, { get total() { calls++; return 2; }, set total(v) { calls += 10; }, calls: 0 }); } } return s; }
show("f30", [SYM], f30);

function f31(round: number) { if (round === 0) { g.w31 ??= new Map(); }  let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; s += g.w31.size; if (i === 12 && round === 1) { g[["", "w31"].filter(Boolean)[0]] = null; } } return s; }
show("f31", ["w31"], f31);
g.w32 ||= { total: 0.5, calls: 1, more: "x" };
function f32(round: number) {   let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; s += g.w32.total; if (i === 2 && round === 3) { Object.defineProperty(g, "w32", { configurable: true, enumerable: true, writable: true, value: ["p", "q"] }); } } return s; }
show("f32", ["w32"], f32);
g.w33 ??= Object.freeze({ total: 1, calls: 1 });
function f33(round: number) {   let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; s = (s + g.w33.total) | 0; s += g.w33.total; } return s; }
show("f33", ["w33"], f33);
(globalThis as any).w34 = { total: 0.5, calls: 1, more: "x" };
function f34(round: number) {   let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; delete (globalThis as any).w34.calls; s += (globalThis as any).w34.total; } return s; }
show("f34", ["w34"], f34);

function f35(round: number) { if (round === 0) { globalThis["w35"] = (x: any, y = 3) => x + y; }  let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; s += globalThis["w35"]?.(x); } return s; }
show("f35", ["w35"], f35);
globalThis["w36"] = { total: 0, calls: 1 };
function f36(round: number) {  if (round === 2) { delete g["w36"]; } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; globalThis["w36"].total = "z" + i; if (i === 5 && round === 1) { delete g["w36"]; } } return s; }
show("f36", ["w36"], f36);
g.w37 ||= [];
function f37(round: number) {   let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (i === 0 && round === 0) { g.w37 = null; } g.w37.push(x); } return s; }
show("f37", ["w37"], f37);

function f38(round: number) { if (round === 0) { globalThis["w38"] ||= [1, 2, 3]; } if (round === 2) { Object.defineProperty(g, "w38", { configurable: true, enumerable: true, writable: true, value: new Proxy({}, { get: (t, k) => (calls++, 1), set: () => (calls++, true) }) }); } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; s += globalThis["w38"].map((y: any) => y).length; s += globalThis["w38"].map((y: any) => y).length; s = (s + globalThis["w38"][i & 3]) | 0; } return s; }
show("f38", ["w38"], f38);
g.w39 ||= { total: 0.5, calls: 1, more: "x" };
function f39(round: number) {   let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (i === 4 && round === 0) { g.w39 = new Counter(); } g.w39.more = x; } return s; }
show("f39", ["w39"], f39);

function f40(round: number) { if (round === 0) { g[SYM] = { total: 0.5, calls: 1, more: "x" }; } if (round === 2) { Reflect.set(g, SYM, null); } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; g[SYM].more = x; if (i === 8 && round === 2) { Reflect.set(g, SYM, null); } } return s; }
show("f40", [SYM], f40);
g.w41 = { a: { b: "t" }, f: (x: any) => x };
function f41(round: number) {  if (round === 2) { Object.defineProperty(g, "w41", { configurable: true, enumerable: true, get: () => (calls++, { total: 5 }), set: () => { calls += 100; } }); } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; s = (s + g.w41.a.b) | 0; g.w41.a = { b: x }; if (i === 0 && round === 2) { Object.defineProperty(g, "w41", { configurable: true, enumerable: true, get: () => (calls++, { total: 5 }), set: () => { calls += 100; } }); } g.w41.a.b++; } return s; }
show("f41", ["w41"], f41);
g.w42 = { total: 0.5, calls: 1, more: "x" };
function f42(round: number) {  if (round === 2) { Object.defineProperty(g, "w42", { configurable: true, enumerable: true, get: () => (calls++, new Proxy({}, { get: (t, k) => (calls++, 1), set: () => (calls++, true) })), set: () => { calls += 100; } }); } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; g.w42.calls++; delete g.w42.calls; if (i === 1 && round === 1) { Object.defineProperty(g, "w42", { configurable: true, enumerable: true, get: () => (calls++, new Proxy({}, { get: (t, k) => (calls++, 1), set: () => (calls++, true) })), set: () => { calls += 100; } }); } s = (s + g.w42.total) | 0; } return s; }
show("f42", ["w42"], f42);

function f43(round: number) { if (round === 0) { g.w43 ||= { total: 0.5, calls: 1, more: "x" }; }  let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; s += g.w43.total; delete g.w43.calls; } return s; }
show("f43", ["w43"], f43);
g.w44 ||= { total: 0.5, calls: 1, more: "x" };
function f44(round: number) {  if (round === 2) { Object.defineProperty(g, "w44", { configurable: true, enumerable: true, writable: true, value: new Other() }); } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; g.w44.more = x; } return s; }
show("f44", ["w44"], f44);

function f45(round: number) { if (round === 0) { g[SYM] = new Counter(); } if (round === 2) { delete g[SYM]; } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; s = (s + g[SYM].hit(x)) | 0; g[SYM].n = x; g[SYM].n = x; } return s; }
show("f45", [SYM], f45);
g.w46 = [1, 2, 3];
function f46(round: number) {  if (round === 2) { g[["", "w46"].filter(Boolean)[0]] = { total: 5 }; } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; if (i === 6 && round === 1) { g[["", "w46"].filter(Boolean)[0]] = { total: 5 }; } s += g.w46.map((y: any) => y).length; } return s; }
show("f46", ["w46"], f46);

function f47(round: number) { if (round === 0) { g.w47 = []; } if (round === 2) { Object.defineProperty(g, "w47", { configurable: true, enumerable: true, get: () => (calls++, null), set: () => { calls += 100; } }); } let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; g.w47.push(x); if (i === 10 && round === 3) { Object.defineProperty(g, "w47", { configurable: true, enumerable: true, get: () => (calls++, null), set: () => { calls += 100; } }); } s += g.w47.length; } return s; }
show("f47", ["w47"], f47);
globalThis["w48"] ||= xs.slice();
function f48(round: number) {   let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; s += globalThis["w48"].map((y: any) => y).length; for (const y of globalThis["w48"]) s = (s + y) | 0; s += globalThis["w48"].map((y: any) => y).length; if (i === 5 && round === 3) { delete g["w48"]; } } return s; }
show("f48", ["w48"], f48);
g.w49 ??= { a: { b: "t" }, f: (x: any) => x };
function f49(round: number) {   let s: any = 0; for (let i = 0; i < xs.length; i++) { const x = xs[i]!; g.w49.a = { b: x }; } return s; }
show("f49", ["w49"], f49);
