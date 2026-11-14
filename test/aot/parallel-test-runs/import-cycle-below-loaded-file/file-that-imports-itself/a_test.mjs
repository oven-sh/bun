import { test } from "bun:test";
import { read } from "./reader.mjs";
test("a", () => { console.log("SAID a", read()); });
