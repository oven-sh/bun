// Properties, names, `bind`, `arguments`, defaults, `prototype` and the identity of functions.
declare const console: { log(...values: unknown[]): void };
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + (e instanceof Error ? e.name + ": " + e.message.split("\n")[0] : String(e))) } }
function hide(v: unknown): any { return v }
function parse(t: string): any { return JSON.parse(t) }
function add(a: number, b: number): number { return a + b }
row("properties on a function", () => { const f: any = hide(add); f.note = "n"; return f.note + " " + Object.keys(f).join() + " " + f.name + " " + f.length });
row("name and length changed", () => { const f = (a: number) => a; Object.defineProperty(f, "name", { value: "renamed" }); return f.name + " " + f.length });
row("bind, call, apply", () => add.bind(null, 1)(2) + " " + add.call(null, 1, 2) + " " + add.apply(null, [1, 2]) + " " + add.bind(null, 1).name + " " + add.bind(null, 1).length);
row("a plain function as a constructor", () => { function Old(this: any, v: number) { this.v = v } Old.prototype.get = function () { return this.v }; const o = new (hide(Old))(3); return o.get() + " " + (o instanceof Old) + " " + o.constructor.name });
row("arguments", () => { function f(this: unknown, a?: number, b?: number) { return arguments.length + " " + arguments[1] + " " + typeof arguments } return hide(f)(1, 2, 3) });
row("fewer and more arguments than parameters", () => hide(add)(1) + " " + hide(add)(1, 2, 3));
row("a default that reads an earlier parameter", () => { const f = (a: number, b = a * 2, ...rest: number[]) => a + b + rest.length; return f(1) + " " + f(1, 5) + " " + f(1, undefined, 7, 8) + " " + f.length });
row("the prototype property", () => typeof hide(add).prototype + " " + typeof hide(() => 1).prototype + " " + (hide(add).prototype.constructor === add));
row("a function compared and kept in a Map", () => { const m = new Map<unknown, number>(); const f = () => 1; m.set(f, 1); m.set(add, 2); return m.get(f) + " " + m.get(add) + " " + (add === hide(add)) });
row("a closure made in a loop is another each time", () => { const l: (() => number)[] = []; for (let k = 0; k < 3; ++k) l.push(() => k); return l.map(f => f()).join() + " " + (l[0] === l[1]) });
row("a method is one function for all instances", () => { class C { m(): number { return 1 } } return (new C().m === new C().m) + " " + (new C().m === C.prototype.m) });
row("caller and callee in strict code", () => { try { return String(hide(add).caller) } catch (e) { return (e as Error).name } });
