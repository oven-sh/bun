// lists of classes
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
class A { name() { return "a"; } } class B extends A { name() { return "b"; } }
const classes: Array<new () => A> = []; classes.push(A); classes.push(B);
for (let i = 0; i < hidden<number>("3"); i++) { const c = classes[i]; out.push(c ? new c().name() + (c === B) : "none"); }
console.log(out.join(" | "));
