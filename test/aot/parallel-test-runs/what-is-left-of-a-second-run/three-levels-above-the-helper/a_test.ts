import { three } from "./three";
import { test } from "bun:test";
test("a", async () => { console.log("a", three, (await import("./tax")).rate); });
