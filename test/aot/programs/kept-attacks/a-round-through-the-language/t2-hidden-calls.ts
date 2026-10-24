// A round through the language: hidden calls. It prints what plain Bun prints.
function say(label: string, v: unknown): void { console.log(label + " " + typeof v + " " + String(v)); }
type P = { x: number };
function sum(p: P, n: number): number { return p.x + n; }
function len(s: string): number { return s.length; }
class A { x = 1; m(k: number): number { return this.x + k; } get g(): number { return this.x * 2; } set s(v: number) { this.x = v + 1; } }
const a = new A();
say("sum", sum({ x: 1 }, 2));
say("call", sum.call(null, { x: "a" } as any, "b" as any));
say("apply", sum.apply(null, [{ x: 2 }, "c"] as any));
say("reflect", Reflect.apply(sum, undefined, [{ x: "r" }, 1]));
say("bind", (sum.bind(null, { x: "bound" } as any) as any)("d"));
say("bind-ok", sum.bind(null, { x: 3 })(4));
say("len", len("abc")); say("len-arr", (len as any)([1, 2])); say("len-num", (len as any)(5)); say("len-call", len.call(null, { length: "L" } as any));
say("m", a.m(1)); say("m-call", A.prototype.m.call({ x: "o" } as any, 2)); say("m-num", A.prototype.m.call(7 as any, 2)); say("m-arg", (a as any).m("k"));
say("m-bind", a.m.bind({ x: "bx" } as any)(1)); say("m-reflect", Reflect.apply(A.prototype.m, "str", [1]));
const gd = Object.getOwnPropertyDescriptor(A.prototype, "g")!, sd = Object.getOwnPropertyDescriptor(A.prototype, "s")!;
say("getter", a.g); say("getter-call", gd.get!.call({ x: "q" })); say("getter-num", gd.get!.call(3));
const o: any = { x: 0 }; sd.set!.call(o, "w"); say("setter-call", o.x);
(a as any).s = "v"; say("setter-any", a.x); say("after", a.m(1)); say("after-g", a.g);
const borrowed: any = { x: "bor", m: A.prototype.m }; say("borrowed", borrowed.m(1));
const made: any = Object.create(A.prototype); say("created", made.m(1)); made.x = "cx"; say("created-2", made.m(1));
say("map", ["a", "bc"].map(len).join()); say("map-bad", ([1, [2, 3], "x"] as any[]).map(len).join());
say("sort", [{ x: 2 }, { x: 1 }].sort((p: P, q: P): number => p.x - q.x).map((p: P): number => p.x).join());
say("sort-bad", ([{ x: "b" }, { x: "a" }, 3] as any[]).sort((p: P, q: P): number => p.x - q.x).length);
say("reduce-bad", (["a", 1] as any[]).reduce((t: number, n: number): number => t + n, 0));
