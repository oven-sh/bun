import { test, vi, mock, jest } from "bun:test";
const got = load => load.then(it => "loaded " + JSON.stringify(it), error => error.name + ": " + String(error.message).replace(/[^ ']*\//g, ""));
const err = load => load.then(it => "loaded " + JSON.stringify(it), error => error);
const now = deed => { try { return String(deed()); } catch (e) { return "threw " + e.name + " " + String(e.message).replace(/\/\S*\//g, "").slice(0, 60); } };
test("a", async () => { vi.doMock("./wick.mjs", () => new Promise(() => {})); console.log("SAID", now(() => import.meta.require("./lamp.mjs").seen), "|", now(() => import.meta.require("./shade.cjs").seen), "|", globalThis.ran); });
