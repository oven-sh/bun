import { test } from "bun:test";
import * as it from "./place.mjs";
test("the next test file imports the file itself", () => console.log("SAID", it.rate, [it.at, it.later()].join(" ").replaceAll(import.meta.dir, "HERE")));
