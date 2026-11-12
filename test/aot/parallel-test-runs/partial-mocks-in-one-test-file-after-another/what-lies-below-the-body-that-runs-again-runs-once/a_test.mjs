import { mock, test } from "bun:test";
mock.module("./dep.mjs", async () => ({ ...(await import("./dep.mjs")), extra: "a" }));
test("a", async () => console.log("| a " + (await import("./dep.mjs")).kind));
