import { test } from "bun:test";
import data from "./hexadecimal.txt" with { type: "json" };
test("never runs", () => { console.log("loaded " + JSON.stringify(data)); });
