import d from "assets/data.json";
const show = (v) => typeof v === "function" ? "fn:" + v.name : typeof v === "symbol" ? String(v) : typeof v === "bigint" ? v + "n" : v === undefined ? "undefined" : JSON.stringify(v, (k, x) => typeof x === "function" ? "fn:" + x.name : typeof x === "bigint" ? x + "n" : x === undefined ? "undef" : x);
const said = (e) => "THROWS " + (e && e.name) + (e && e.code ? " " + e.code : "") + (e && /\(bun compile/.test(String(e.message)) ? " [--aot: " + String(e.message).split(" (bun")[0].slice(0, 110) + "]" : "");
const t = (name, f) => { try { console.log(name, show(f())); } catch (e) { console.log(name, said(e)); } };
const ta = async (name, f) => { try { console.log(name, show(await f())); } catch (e) { console.log(name, said(e)); } };
const keys = (o) => Object.keys(o).filter((k) => k !== "__esModule").sort().join();
t("d", () => d); t("keys", () => Object.keys(d).join()); t("proto", () => [d.polluted, Object.getPrototypeOf(d) === Object.prototype, Object.hasOwn(d, "__proto__")]); t("neg", () => Object.is(d.neg, -0)); t("big", () => d.big);
