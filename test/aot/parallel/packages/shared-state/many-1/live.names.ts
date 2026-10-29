import d, { n, inc, later, set, alias, fn, swap } from "live";
const show = (v: unknown): string => typeof v === "function" ? "fn:" + v.name : typeof v === "symbol" ? String(v) : typeof v === "bigint" ? v + "n" : v === undefined ? "undefined" : JSON.stringify(v, (k: string, x: unknown) => typeof x === "function" ? "fn:" + x.name : typeof x === "bigint" ? x + "n" : x === undefined ? "undef" : x);
const said = (e: any): string => "THROWS " + (e && e.name) + (e && e.code ? " " + e.code : "") + (e && /\(bun compile/.test(String(e.message)) ? " [--aot: " + String(e.message).split(" (bun")[0]!.slice(0, 110) + "]" : "");
const t = (name: string, f: () => unknown): void => { try { console.log(name, show(f())); } catch (e) { console.log(name, said(e)); } };
const ta = async (name: string, f: () => unknown): Promise<void> => { try { console.log(name, show(await f())); } catch (e) { console.log(name, said(e)); } };
const keys = (o: object): string => Object.keys(o).filter((k) => k !== "__esModule").sort().join();
t("0", () => [n + 1, alias, d, later, fn()]);
inc(); inc(); set("set"); swap();
t("1", () => [n + 1, alias, d, later, later?.length, fn()]);
function inner(): unknown { return [n * 2, alias, later, fn()]; }
inc();
t("2", inner);
let sum = 0; for (let i = 0; i < 3; i++) { inc(); sum += n; }
t("loop", () => sum);
