import { test } from "bun:test";
const limit = (promise, time = 1000) => Promise.race([promise, new Promise(done => setTimeout(done, time, "HANGS"))]);
test("a ring through a mock", async () => {
    const one = await limit(import("./a1.mjs").then(found => found.v, error => error.name));
    const two = await limit(import("./b1.mjs").then(found => found.v, error => error.name));
    console.log("SAID", one, two, globalThis.heard);
}, 4000);
