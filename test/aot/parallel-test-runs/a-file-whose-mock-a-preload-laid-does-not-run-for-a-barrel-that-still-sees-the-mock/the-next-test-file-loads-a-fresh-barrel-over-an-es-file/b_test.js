import { test, vi } from "bun:test";
const keys = space => Object.keys(space).filter(key => key !== "default").sort().join();
const say = (...words) => console.log("SAID", ...words, globalThis.runs ?? 0);
test("two", async () => { say("yard", keys(await import("./yard.js"))); say("porch", keys(await import("./porch.js"))); });
