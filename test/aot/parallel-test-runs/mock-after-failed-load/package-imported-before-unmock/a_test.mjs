import { test } from "bun:test";
import { grain } from "flour";
test("a", () => console.log("SAID a", grain));
