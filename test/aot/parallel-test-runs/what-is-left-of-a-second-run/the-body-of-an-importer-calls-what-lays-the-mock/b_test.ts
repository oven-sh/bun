import "./early";
import "./helper";
import "./between";
import { mid } from "./mid";
import { test } from "bun:test";
test("b", async () => { console.log("b", mid, (await import("./tax")).rate); });
