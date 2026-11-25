import "./helper";
import { test } from "bun:test";
test("b", async () => { console.log("b", (await import("./tax")).rate, (await import("./reader")).read()); });
