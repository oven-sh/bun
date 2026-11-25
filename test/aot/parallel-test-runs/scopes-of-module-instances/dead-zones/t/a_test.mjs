import { test, expect, vi, mock } from "bun:test";
const say = (...all) => console.log("SAID", ...all);
import { use } from "../src/lib.mjs";
test("dead-zones", async () => { say(await use()); say(await use()); });
