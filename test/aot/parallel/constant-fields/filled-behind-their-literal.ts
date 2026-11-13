// Objects of constants that are filled behind their literal, beside objects of the same shape that parsers, copies and proxies give.
interface Limits { MAX: number; ON: boolean; NAME: string; TAG: "a" | "b" }
const C = {} as Limits; C.MAX = 1000; C.ON = true; C.NAME = "limits"; C.TAG = "a";
const D: Limits = JSON.parse('{"MAX":5,"ON":false,"NAME":"parsed","TAG":"b"}');
const E: Limits = structuredClone(C); E.MAX = 7;
const F = Object.fromEntries([["MAX", 9], ["ON", false], ["NAME", "entries"], ["TAG", "b"]]) as unknown as Limits;
const G: Limits = { ...C, MAX: 11 };
const H: Limits = Object.assign({}, C, { ON: false });
const I: Limits = Object.create(C);
const J = new Proxy(C, { get(t, k) { return k === "MAX" ? 13 : Reflect.get(t, k); } });
const K: Limits = Object.assign(Object.create(null), D);
const L: Limits = JSON.parse(JSON.stringify(C), (k, v) => (typeof v === "number" ? v * 2 : v));
function show(x: Limits): string { return [x.MAX, x.MAX > 100, x.ON ? "on" : "off", x.NAME, x.NAME === "limits", x.TAG, x.TAG === "a"].join(" "); }
function sum(list: Limits[]): number { let s = 0; for (const x of list) { s += x.MAX; if (x.ON) s += 10000; if (x.TAG === "b") s += 100000; } return s; }
for (const x of [C, D, E, F, G, H, I, J, K, L]) console.log(show(x));
console.log(sum([C, D, E, F, G, H, I, J, K, L]));
function direct(): string { return [C.MAX, D.MAX, E.MAX, F.MAX, G.MAX, H.MAX, I.MAX, J.MAX, K.MAX, L.MAX, C.ON, D.ON, E.ON, F.ON, G.ON, H.ON, C.TAG, D.TAG].join(" "); }
console.log(direct());
export {};
