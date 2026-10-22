// A round through the language: call apply bind. It prints what plain Bun prints.
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
