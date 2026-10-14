// A module-level variable holding a function is reassigned by a pattern with a default in the head of a `for..of` loop.
const show = (x) => { try { return typeof x === "function" ? "function " + x.name : typeof x === "symbol" ? "symbol" : typeof x === "bigint" ? "bigint" : typeof x === "object" && x ? "object" : String(x); } catch (e) { return "threw " + e.name; } };
const attempt = (g) => { try { return show(g()); } catch (e) { return "threw " + e.name; } };
const two = () => "two"; const three = (m) => () => "three" + m;
const n = 1; const one = () => "one" + n; let f = one;
function t(_, V) { f = one; for ([f = one] of [[V]]) ; return [attempt(() => f()), attempt(() => (() => f())()), f === one, typeof f, attempt(() => [0].map(f)[0])]; }
for (const V of [two, three(5), 7, "text", { call: 1 }, new Proxy(two, {}), undefined, null, class K {}, two.bind(null), async () => 9, 1.5, true, 10n, Symbol.iterator, [two]]) console.log(attempt(() => t(1, V).join(" | ")));
