// The partial mock of a package that is an ES module.
import { test, mock } from "bun:test";
mock.module("levy", async () => ({ ...(await import("levy")), rate: "mock rate" }));
test("a", async () => { const levy = await import("levy"); console.log("a", levy.rate, levy.fee, levy.default()); });
