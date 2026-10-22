// `const f = data() as Free; const w = { f, k: 1 }` is passed to a function that takes the record type.
declare const console: { log(...values: unknown[]): void };
import { readsFree, makesFree, makesWrap, readsWrap } from "./lib";
import type { Free, Wrap } from "./lib";
function say(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + String(e).replace(/\(bun compile[^)]*\)/, "").replace(/\n */g, " / ").slice(0, 110)) } }
function data(): any { return JSON.parse(`{"piece":{"part":1},"title":"b"}`) }
say("control", () => readsFree(makesFree(2)) + readsWrap(makesWrap(3)));
say("a const, then a shorthand member", () => { const f = data() as Free; const w = { f, k: 1 }; return readsWrap(w) });
