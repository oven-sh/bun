// `{ inner: data() as Free }` without an annotation; the member is read and passed to typed code.
declare const console: { log(...values: unknown[]): void };
import { readsFree, makesFree } from "./lib";
import type { Free } from "./lib";
function say(name: string, f: () => unknown): void { try { console.log(name + ": " + String(f())) } catch (e) { console.log(name + ": THROWS " + String(e).replace(/\(bun compile[^)]*\)/, "").replace(/\n */g, " / ").slice(0, 110)) } }
function data(): any { return JSON.parse(`{"piece":{"part":1},"title":"b"}`) }
say("control", () => readsFree(makesFree(2)));
say("as T, a member of a literal with no annotation", () => { const l = { inner: data() as Free, name: "h" }; return readsFree(l.inner) });
