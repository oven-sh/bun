// rest parameters and arguments
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
function rest(...items: any[]) { items.push("pushed"); { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(items[i])); out.push(got.join()); } }
function args(this: any, a?: any, b?: any) { arguments[1] = "stored"; { const got: string[] = []; for (let i = 0; i < hidden<number>("4"); i++) got.push(say(arguments[i])); out.push(got.join()); } out.push(say(b)); }
rest(); rest({ v: 1 }); rest(1, "two", 3); args(); args(1); args(1, 2, 3);
console.log(out.join(" | "));
