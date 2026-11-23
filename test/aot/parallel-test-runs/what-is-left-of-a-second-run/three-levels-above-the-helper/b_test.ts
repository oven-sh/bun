import "./early";
import { three } from "./three";
import { test } from "bun:test";
test("b", async () => { console.log("b", three, (await import("./tax")).rate); });
