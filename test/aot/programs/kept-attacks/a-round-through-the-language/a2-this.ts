// A round through the language, one probe of many. It prints what plain Bun prints.
function show(label: string, f: () => unknown) {
  try { console.log(label, String(f())); } catch (e) { console.log(label, "threw", (e as any)?.name ?? String(e)); }
}
class A {
  x = 1; name = "a";
  m(): number { return this.x + 1; }
  n(k: number): string { return this.name + k; }
  get g(): number { return this.x * 2; }
  set s(v: number) { this.x = v + 1; }
  static make(v: number): A { const a = new A(); a.x = v; return a; }
}
class B extends A { y = "why"; m(): number { return super.m() + this.y.length; } }
const a = new A(), b = new B();
show("m", () => a.m());
show("m-call-obj", () => A.prototype.m.call({ x: "s" } as any));
show("m-call-num", () => A.prototype.m.call(5 as any));
show("m-call-undef", () => A.prototype.m.call(undefined as any));
show("m-detached", () => { const m = a.m; return m(); });
show("m-reflect", () => Reflect.apply(A.prototype.m, "str", []));
show("m-bind", () => a.m.bind({ x: [7] } as any)());
show("n-call", () => A.prototype.n.call({ name: 4 } as any, "k" as any));
show("B.m-on-A", () => B.prototype.m.call(a as any));
show("B.m-on-obj", () => B.prototype.m.call({ x: 1, y: 5 } as any));
const gd = Object.getOwnPropertyDescriptor(A.prototype, "g")!;
const sd = Object.getOwnPropertyDescriptor(A.prototype, "s")!;
show("getter-call", () => gd.get!.call({ x: "q" }));
show("getter-call-2", () => gd.get!.call(3));
show("setter-call", () => { const o: any = { x: 0 }; sd.set!.call(o, "w"); return o.x; });
show("setter-any", () => { (a as any).s = "v"; return a.x; });
show("after", () => a.m());
show("proto-obj", () => { const o = Object.create(A.prototype); return o.m() + "|" + o.g + "|" + o.n(1); });
show("proto-obj-2", () => { const o = Object.create(A.prototype); o.x = "text"; o.name = 9; return o.m() + "|" + o.g + "|" + o.n(1); });
show("borrow", () => { const o: any = { x: "bx", m: A.prototype.m }; return o.m(); });
show("static", () => (A.make as any)("nope").m());
show("setproto", () => { const o: any = { x: {} }; Object.setPrototypeOf(o, B.prototype); return o.m(); });
