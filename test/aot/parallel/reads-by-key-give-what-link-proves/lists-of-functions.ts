// lists of functions
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const handlers: Array<(x: number) => unknown> = []; handlers.push(x => x + 1); handlers.push(x => "text " + x);
function run() { for (let i = 0; i < hidden<number>("4"); i++) { const h = handlers[i]; try { out.push(h ? say(h(1)) : "none"); } catch (e) { out.push((e as Error).constructor.name); } } }
run(); handlers.push(function named(x) { return { v: x }; }); (handlers as any)[0] = { call: "no function" }; run();
console.log(out.join(" | "));
