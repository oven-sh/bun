import { test } from "bun:test";
import * as between from "./src/between";
test("first", () => { console.log("SEEN first", typeof between.own); Bun.plugin.clearAll(); });
