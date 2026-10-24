// `exports.f` is reassigned by an array destructuring pattern with a default in a CommonJS module.
const show = (x) => { try { return typeof x === "function" ? "function " + x.name : typeof x === "symbol" ? "symbol" : typeof x === "bigint" ? "bigint" : typeof x === "object" && x ? "object" : String(x); } catch (e) { return "threw " + e.name; } };
const attempt = (g) => { try { return show(g()); } catch (e) { return "threw " + e.name; } };
const two = () => "two"; const three = (m) => () => "three" + m;
const one = () => "one"; exports.f = one;
function t(n, V) { exports.f = one; [exports.f = one] = [V]; return [attempt(() => exports.f()), exports.f === one, typeof exports.f]; }
for (const V of [two, three(5), 7, "text", { call: 1 }, new Proxy(two, {}), undefined, null, class K {}, two.bind(null), async () => 9, 1.5, true, 10n, Symbol.iterator, [two]]) console.log(attempt(() => t(1, V).join(" | ")));
