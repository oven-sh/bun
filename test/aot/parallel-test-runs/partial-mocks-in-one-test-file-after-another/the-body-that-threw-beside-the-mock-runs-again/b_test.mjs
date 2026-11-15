import { test } from "bun:test";
test("b", async () => console.log("| b " + await import("./dep.mjs").then(dep => dep.kind, error => error.message)));
