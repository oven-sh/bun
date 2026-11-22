import { test } from "bun:test";
import * as it from "place";
test("the next test file imports the file itself", () => console.log("SAID", it.rate, [it.isOwn(), it.extra(), it.url, it.meta().url, Object.keys(it.meta()).join()].join(" ").replaceAll(import.meta.dir, "HERE")));
