// A variable holding a function is reassigned by an object destructuring pattern in shorthand form with a default.
const show = (x) => { try { return typeof x === "function" ? "function " + x.name : typeof x === "symbol" ? "symbol" : typeof x === "bigint" ? "bigint" : typeof x === "object" && x ? "object" : String(x); } catch (e) { return "threw " + e.name; } };
const attempt = (g) => { try { return show(g()); } catch (e) { return "threw " + e.name; } };
const two = () => "two"; const three = (m) => () => "three" + m;
function t(n, V) { const one = () => "one"; let f = one; ({ f = one } = { f: V }); return [attempt(() => f()), attempt(() => (() => f())()), f === one, typeof f, attempt(() => [0].map(f)[0])]; }
for (const V of [two, three(5), 7, "text", { call: 1 }, new Proxy(two, {}), undefined, null, class K {}, two.bind(null), async () => 9, 1.5, true, 10n, Symbol.iterator, [two]]) console.log(attempt(() => t(1, V).join(" | ")));
