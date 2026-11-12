import { test } from "bun:test";
import * as it from "place";
test("the next test file imports the file itself", () => console.log("SAID", it.rate, [it.later(), it.defaulted(), it.resolved(), it.made()].join(" ").replaceAll(import.meta.dir, "HERE")));
