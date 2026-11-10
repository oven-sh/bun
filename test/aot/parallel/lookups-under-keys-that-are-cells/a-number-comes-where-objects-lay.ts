const N = (text: string): number => JSON.parse(text);
const keys: string[] = JSON.parse('["a", "b", "c"]');
function f(m: Map<string, any>, n: number) { let t = ""; for (let i = 0; i < n; i++) { const k = keys[i % 3]!; const v = m.get(k); m.set(k, typeof v === "number" ? v + 0.5 : 1); t += (typeof v)[0]; } return t; }
const m = new Map<string, any>(); m.set("a", {}); m.set("b", null); m.set("c", "text");
console.log(f(m, N("9")), [...m].join(" "));
function g(m: Map<string, any>, n: number) { for (let i = 0; i < n; i++) { const k = keys[i % 3]!; const v = m.get(k); m.set(k, v === undefined ? keys : i & 1 ? undefined : v); } }
const o = new Map<string, any>(); o.set("a", keys); o.set("b", undefined);
g(o, N("8")); console.log([...o].map(([k, v]) => k + ":" + (v === keys ? "list" : v)).join(" "));
