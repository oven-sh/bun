import { test, spyOn } from "vitest";
import * as all from "./part.mjs";
test("t", () => { spyOn(all, "get").mockReturnValue(7); console.log("SAID", all.get()); });
