// Object.prototype.toString of proxies, revoked and not: the error names the function that was called, however it was reached. Padding to a gigabyte is not done while the program is built.
const attempt = f => { try { return String(f()); } catch (error) { return error.name + ": " + error.message; } };
const make = target => { const { proxy, revoke } = Proxy.revocable(target, {}); return { proxy, revoke }; };
const one = make({}), list = make([]), nested = make([]); const outer = new Proxy(nested.proxy, {});
const tagged = new Proxy({ get [Symbol.toStringTag]() { return "Tagged"; } }, {});
function text(value) { return Object.prototype.toString.call(value); }
const toString = Object.prototype.toString;
function held(value) { return toString.call(value); }
function applied(value) { return Object.prototype.toString.apply(value); }
function asMethod(value) { return { toString: Object.prototype.toString, __proto__: null }.toString.call(value); }
for (const f of [text, held, applied, asMethod]) console.log(f.name, attempt(() => f(one.proxy)), attempt(() => f(list.proxy)), attempt(() => f(outer)), attempt(() => f(tagged)), attempt(() => f(new Proxy(function () {}, {}))));
one.revoke(); list.revoke(); nested.revoke();
for (const f of [text, held, applied, asMethod]) console.log(f.name, attempt(() => f(one.proxy)), "|", attempt(() => f(list.proxy)), "|", attempt(() => f(outer)), "|", attempt(() => Array.isArray(one.proxy)), "|", attempt(() => Array.isArray(outer)));
console.log("ab".padEnd(2 ** 30, "xy").length, "ab".padStart(2 ** 30, "xy").length, "ab".padEnd(70000).length, "ab".padEnd(7, "xy"), "ab".padStart(6, "xy"), attempt(() => "ab".padStart(2 ** 31, "xy").length), "ab".padStart(2 ** 31, "").length);
