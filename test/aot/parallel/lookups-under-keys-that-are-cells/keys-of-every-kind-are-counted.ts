const N = (text: string): number => JSON.parse(text);
const o = {}, s = Symbol("s"), joined = ["ro", "pe"].map(part => part + "").reduce((a, b) => a + b);
const keys: any[] = [o, "a", 7, 2.5, -0, 0, NaN, 4294967296.5, 2147483648, -2147483649, s, null, undefined, true, 10n, 10n ** 30n, joined, "rope", "", 1e21];
function count(m: Map<any, number>, n: number) { for (let i = 0; i < n; i++) { const k = keys[i % keys.length]; m.set(k, (m.get(k) ?? 0) + 1); } }
function ropes(m: Map<any, number>, a: string, n: number) { for (let i = 0; i < n; i++) { const k = a + (i & 3); m.set(k, (m.get(k) ?? 0) + 1); } }
const m = new Map<any, number>();
count(m, N("47")); ropes(m, "key-that-is-joined-at-each-turn-", N("9"));
console.log(m.size, [...m].map(([k, v]) => String(typeof k === "symbol" ? "sym" : typeof k === "object" && k ? "obj" : typeof k === "bigint" ? k + "n" : Object.is(k, -0) ? "-0" : k) + "=" + v).join(" "));
