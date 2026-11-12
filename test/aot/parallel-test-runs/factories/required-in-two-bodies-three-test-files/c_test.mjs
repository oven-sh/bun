import { test, vi, mock, jest } from "bun:test";
const word = it => { try { return JSON.stringify(it); } catch (e) { return e.name; } };
const got = load => load.then(it => word(it), error => error.name);
const now = deed => { try { return word(deed()); } catch (e) { return "threw " + e.name; } };
const say = (...words) => console.log("SAID", ...words, globalThis.ran);
import { other } from "./other.mjs";
test("c", async () => { say(other, await got(import("./tax.mjs"))); });
