import { test, spyOn } from "vitest";
test("t", () => { const spy = spyOn(Math, "floor").mockReturnValue(7); console.log("SAID", Math.floor(1.5), Math.ceil(1.5)); spy.mockRestore(); console.log("SAID", Math.floor(1.5)); });
