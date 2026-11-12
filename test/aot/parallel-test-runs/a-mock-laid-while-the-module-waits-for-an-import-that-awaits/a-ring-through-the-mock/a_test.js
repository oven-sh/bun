import { test } from "bun:test";
test("a ring through a mock", async () => {
    const one = await import("./a1.mjs").then(found => found.v, error => error.name);
    const two = await import("./b1.mjs").then(found => found.v, error => error.name);
    console.log("SAID", one, two, globalThis.heard);
}, 4000);
