import { test } from "bun:test";
import { count, kept } from "./store.js";
import { typed } from "./store.ts.helper.ts";
test("the file loads", () => { console.log(count, kept, typed); });
