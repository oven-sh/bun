// a record read by key
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const record = { a: 1, b: "two", c: { v: 3 } }; const names = ["a", "b", "c", "d"] as const;
for (const k of names) out.push(say((record as any)[k]));
for (const k in record) out.push(say((record as any)[k]));
console.log(out.join(" | "));
