// A typed object is made the global object of a node:vm context, and text that runs there reads it, stores to it, declares variables and deletes a property: its keys keep their order, and a delete takes one key away.
declare const console: { log(...v: unknown[]): void }; declare const require: any;
const vm = require("node:vm");
const show = (v: unknown): string => { try { return typeof v === "string" ? v : typeof v === "function" ? "function" : typeof v === "symbol" ? v.toString() : JSON.stringify(v) ?? String(v); } catch (e) { return "unshowable " + (e as Error).name; } };
const row = (name: string, f: () => unknown): void => { let t: string; try { t = show(f()); } catch (e) { t = "THROWS " + ((e as any)?.name ?? typeof e) + ": " + String((e as any)?.message).split("\n")[0].slice(0, 70); } console.log(name + ": " + t); };
const ctx = vm.createContext({});
const there = (code: string): any => vm.runInContext(code, ctx);
interface G { count: number; name: string; extra?: number }
const g: G = { count: 1, name: "g" };
row("make", () => { vm.createContext(g); return vm.isContext(g); });
for (const code of ["count + name", "count = 5; count", "var made = 1; made", "extra = 2; extra", `count = "wrong"; typeof count`, "typeof globalThis.count", "Object.keys(globalThis).join()", "delete globalThis.extra; typeof extra"]) row(code, () => vm.runInContext(code, g));
row("seen here", () => [g.count, g.name, g.extra, Object.keys(g).join()].join("|"));
