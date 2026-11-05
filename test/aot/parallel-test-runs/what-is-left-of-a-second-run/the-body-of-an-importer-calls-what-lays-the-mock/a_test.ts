// The call that lays the mock stands in a function of helper.ts, and the body of mid.ts calls it: it is made again at the turn of mid.ts, not at that of helper.ts.
import { mid } from "./mid";
import { test } from "bun:test";
test("a", async () => { console.log("a", mid, (await import("./tax")).rate); });
