import { test, vi, mock, jest } from "bun:test";
const word = it => { try { return JSON.stringify(it); } catch (e) { return e.name; } };
const got = load => load.then(it => word(it), error => error.name);
const now = deed => { try { return word(deed()); } catch (e) { return "threw " + e.name; } };
const say = (...words) => console.log("SAID", ...words, globalThis.ran);
import * as it from "./mid.mjs";
globalThis.ran = (globalThis.ran ?? "") + "a";
export const own = "a";
test("a", async () => { if (it.go) say("go", now(() => it.go())); say(it.mid, await got(import("./tax.mjs"))); });
