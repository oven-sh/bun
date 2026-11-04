// a list of one function
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const handlers: Array<(x: number) => unknown> = []; for (let i = 0; i < 2; i++) handlers.push(x => x + i);
for (let i = 0; i < hidden<number>("3"); i++) { const h = handlers[i]; out.push(h ? say(h(1)) : "none"); }
console.log(out.join(" | "));
