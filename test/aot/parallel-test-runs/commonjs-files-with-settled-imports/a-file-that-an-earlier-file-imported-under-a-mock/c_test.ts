import { test } from "bun:test";
import * as m from "./reader.cjs";
test("c", () => { console.log("one c", m.n); });
