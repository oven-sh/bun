import { test } from "bun:test";
import { f } from "./m";
test("a", () => { console.log("a", f()); });
