// two lists meet
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const a: any[] = [], b: any[] = []; a.push({ v: 1 }); b.push("text");
function pick(first: boolean) { const l = first ? a : b; { const got: string[] = []; for (let i = 0; i < hidden<number>("2"); i++) got.push(say(l[i])); out.push(got.join()); } }
pick(true); pick(false); pick(hidden<boolean>("true"));
console.log(out.join(" | "));
