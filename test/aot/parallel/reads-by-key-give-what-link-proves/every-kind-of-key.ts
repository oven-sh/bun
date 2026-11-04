// every kind of key
type N = { v: number; tag?: string };
const say = (x: unknown) => x === null ? "null" : typeof x === "object" ? "object:" + JSON.stringify(x) : typeof x === "function" ? "function" : typeof x + ":" + String(x);
(globalThis as any).parse = JSON.parse;
const hidden = <T,>(text: string): T => (globalThis as any).parse(text) as T;
const out: string[] = [];
const list: N[] = []; list.push({ v: 1 }, { v: 2 });
const keys: any[] = [0, 1, 2, -1, 0.5, "0", "1", "length", "push", "constructor", "__proto__", "nothing", NaN, Infinity, -0, 4294967295, 4294967294, "01", " 1", true, null, undefined, Symbol.iterator, { toString() { return "1"; } }, [0], 1n];
for (const k of keys) out.push(say((list as any)[k]));
for (const k of hidden<any[]>('[0, "length", "1", 7]')) out.push(say((list as any)[k]));
console.log(out.join(" | "));
