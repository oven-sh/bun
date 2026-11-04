// maps sets and objects by key
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const bag: Record<string, unknown> = {}; bag[hidden<string>('"a"')] = { v: 1 }; bag["b"] = "text"; const keyed: any = { x: 1 };
for (const k of hidden<string[]>('["a", "b", "c", "toString", "__proto__", "x"]')) out.push(say(bag[k]), say(keyed[k]));
console.log(out.join(" | "));
