// A `catch` parameter is called and reassigned from a closure, with thrown values of every kind.
const show = (x) => { try { return typeof x === "function" ? "function " + x.name : typeof x === "symbol" ? "symbol" : typeof x === "bigint" ? "bigint" : typeof x === "object" && x ? "object" : String(x); } catch (e) { return "threw " + e.name; } };
const attempt = (g) => { try { return show(g()); } catch (e) { return "threw " + e.name; } };
const two = () => "two"; const three = (m) => () => "three" + m;
function t(n, V) { try { throw V; } catch (f) { const later = () => [attempt(() => f()), typeof f, typeof (f = () => "one")]; return later(); } }
for (const V of [two, three(5), 7, "text", { call: 1 }, new Proxy(two, {}), undefined, null, class K {}, two.bind(null), async () => 9, 1.5, true, 10n, Symbol.iterator, [two]]) console.log(attempt(() => t(1, V).join(" | ")));
