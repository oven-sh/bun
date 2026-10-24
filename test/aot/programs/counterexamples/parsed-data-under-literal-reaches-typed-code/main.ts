// A literal that holds parsed JSON reaches a typed function by seven ways, typed and untyped.
declare const console: { log(...values: unknown[]): void };
import { readsHolder, makesHolder } from "./lib";
function row(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + String(e).replace(/\(bun compile[^)]*\)/, "").replace(/\n */g, " / ").slice(0, 200)) } }
function hide(v: unknown): any { return v }
const call: any = hide((f: any, o: any) => f(o));
function data(): any { return JSON.parse(`{"piece":{"part":1},"title":"b"}`) }
row("control: typed", () => readsHolder(makesHolder(2)));
row("control: all from JSON", () => call(readsHolder, JSON.parse(`{"inner":{"piece":{"part":1},"title":"b"},"name":"h"}`)));
row("1 a literal straight to unknown", () => call(readsHolder, hide({ inner: data(), name: "h" })));
row("2 a literal held as any", () => { const l: any = { inner: data(), name: "h" }; return call(readsHolder, l) });
row("3 a literal held with no annotation", () => { const l = { inner: data(), name: "h" }; return call(readsHolder, l) });
row("4 a literal straight to the typed call", () => readsHolder({ inner: data(), name: "h" }));
row("5 a literal with no annotation to the typed call", () => { const l = { inner: data(), name: "h" }; return readsHolder(l) });
row("6 a literal in an array", () => { const list: unknown[] = [{ inner: data(), name: "h" }]; return call(readsHolder, list[0]) });
row("7 a literal returned as unknown", () => { const f = (): unknown => ({ inner: data(), name: "h" }); return call(readsHolder, f()) });
