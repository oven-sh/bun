// Reflect.construct pairs classes, a plain function and built-in classes with other classes, bound functions, proxies and functions whose prototype is no object as new.target.
class A { a: number; s: string; constructor() { this.a = 1; this.s = new.target.name; } who(): string { return "A" + this.a; } }
class B extends A { b: number; constructor() { super(); this.b = 2; } who(): string { return "B" + this.a + this.b; } }
class C { c = 3; who(): string { return "C" + this.c; } }
const F: any = function (this: any) { this.f = 4; };
F.prototype.who = function (this: any) { return "F" + this.f + this.a; };
const bound = A.bind(null);
const proxied = new Proxy(B, {});
const odd = new Proxy(C, { get(t, k, r) { return k === "prototype" ? null : Reflect.get(t, k, r); } });
const G: any = function () {}; G.prototype = 5;
const out: string[] = [];
for (let round = 0; round < 3; round++) {
  for (const [ctor, target] of [[A, A], [A, B], [A, C], [A, F], [B, A], [B, C], [A, bound], [A, proxied], [B, proxied], [A, odd], [A, G], [C, A], [F, A], [F, B], [B, F], [Object, A], [Array, B], [Map, A], [Error, B]] as [any, any][]) {
    let r: string;
    try {
      const o: any = Reflect.construct(ctor, [], target);
      r = [typeof o.who === "function" ? o.who() : "no who", o instanceof A, o instanceof B, o instanceof C, Object.keys(o).join(), o.a, o.b, o.c, o.s, Object.getPrototypeOf(o) === target.prototype].join(" ");
    } catch (e) { r = (e as Error).name + ": " + (e as Error).message; }
    out.push(r);
  }
  if (round === 0) F.prototype = { who() { return "F2"; } };
  if (round === 1) Object.setPrototypeOf(B, C);
}
console.log(out.join("\n"));
