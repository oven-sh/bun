// A round through the language: function types. It prints what plain Bun prints.
function show(label: string, f: () => unknown) {
  try { console.log(label, String(f())); } catch (e) { console.log(label, "threw", (e as any)?.name ?? String(e)); }
}
type P = { x: number };
type NumFn = (n: number) => number;
function run(cb: NumFn, v: number): number { return cb(v) + 1; }
const inc: NumFn = (n) => n + 1;
const sq: NumFn = (n) => n * n;
const px = (p: P): number => p.x;
const len = (s: string): number => s.length;
const retStr = (n: number): any => "s" + n;
show("run", () => run(inc, 1) + run(sq, 3));
show("run-wrong-callee", () => run(px as any, 4));
show("run-wrong-callee2", () => run(len as any, 5));
show("run-wrong-result", () => run(retStr, 6));
show("run-wrong-arg", () => run(inc, "7" as any));
show("run-not-fn", () => run({} as any, 1));
show("run-builtin", () => run(Math.abs, -3) + run(parseInt as any, 8) + run(String as any, 9));
show("run-bound", () => run(px.bind(null, { x: 10 }) as any, 0));
show("run-class", () => run(class { } as any, 0));
class Holder { cb: NumFn; constructor(cb: NumFn) { this.cb = cb; } go(v: number): number { return this.cb(v) * 2; } }
show("holder", () => new Holder(inc).go(1));
show("holder-wrong", () => new Holder(px as any).go(2));
show("holder-wrong2", () => { const h = new Holder(inc); (h as any).cb = len; return h.go(3); });
show("holder-wrong3", () => { const h = new Holder(inc); (h as any).cb = "nope"; return h.go(3); });
show("holder-this", () => { const h = new Holder(function (this: Holder, n: number) { return this === h ? n : -1; } as any); return h.go(4); });
// Many members: a group call.
const many: NumFn[] = [(n) => n + 1, (n) => n + 2, (n) => n + 3, (n) => n + 4, (n) => n + 5, (n) => n + 6, (n) => n + 7, (n) => n + 8, (n) => n + 9, (n) => n + 10, (n) => n + 11, (n) => n + 12];
function pick(i: number): NumFn { return many[i % many.length]; }
show("group", () => { let s = 0; for (let i = 0; i < 24; i++) s += run(pick(i), i); return s; });
many.push(px as any, len as any, retStr);
show("group-wrong", () => { let s: any = 0; for (let i = 0; i < 15; i++) s += run(pick(i), i); return s; });
show("group-wrong-arg", () => { let s: any = 0; for (let i = 0; i < 15; i++) s += run(pick(i), ("a" + i) as any); return s; });
// Methods through an interface.
interface Shape { area(k: number): number }
class Sq implements Shape { constructor(public s: number) {} area(k: number): number { return this.s * this.s * k; } }
class Ci implements Shape { constructor(public r: number) {} area(k: number): number { return this.r * 3 * k; } }
function total(shapes: Shape[], k: number): number { let t = 0; for (const s of shapes) t += s.area(k); return t; }
show("iface", () => total([new Sq(2), new Ci(1)], 2));
show("iface-literal", () => total([{ area: (k: number) => k }, new Sq(1)], 3));
show("iface-wrong", () => total([{ area: len } as any, new Sq(1)], 3));
show("iface-wrong2", () => total([new Sq("2" as any), new Ci({} as any)], "2" as any));
show("iface-wrong3", () => total([{ area: Sq.prototype.area, s: "str" } as any], 2));
show("iface-wrong4", () => total([Object.create(Sq.prototype)], 2));
show("iface-wrong5", () => total(["str", 5, null] as any, 2));
