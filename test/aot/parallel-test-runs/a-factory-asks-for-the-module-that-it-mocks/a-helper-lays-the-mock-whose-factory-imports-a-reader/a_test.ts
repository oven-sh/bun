import "./helper";
import { test } from "bun:test";
test("a", async () => { console.log("a", (await import("./tax")).rate, (await import("./reader")).read()); });
