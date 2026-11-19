import { test } from "bun:test";
import { user } from "./user.mjs";
test("c", async () => { console.log("SAID c", user(), Object.keys(await import("./top.mjs")).sort().join()); });
