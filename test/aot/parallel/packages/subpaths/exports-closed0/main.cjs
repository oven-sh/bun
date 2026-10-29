const show = (v) => typeof v === "function" ? "fn:" + v.name : typeof v === "symbol" ? String(v) : typeof v === "bigint" ? v + "n" : v === undefined ? "undefined" : JSON.stringify(v, (k, x) => typeof x === "function" ? "fn:" + x.name : typeof x === "bigint" ? x + "n" : x === undefined ? "undef" : x);
const said = (e) => "THROWS " + (e && e.name) + (e && e.code ? " " + e.code : "") + (e && /\(bun compile/.test(String(e.message)) ? " [--aot: " + String(e.message).split(" (bun")[0].slice(0, 110) + "]" : "");
const t = (name, f) => { try { console.log(name, show(f())); } catch (e) { console.log(name, said(e)); } };
const ta = async (name, f) => { try { console.log(name, show(await f())); } catch (e) { console.log(name, said(e)); } };
const keys = (o) => Object.keys(o).filter((k) => k !== "__esModule").sort().join();
const s = ["sub/lib/a.js"][0];
t("require", () => require(s).which);
t("resolve", () => typeof require.resolve(s));
/* Output:
require THROWS Error MODULE_NOT_FOUND
resolve "string"
*/
