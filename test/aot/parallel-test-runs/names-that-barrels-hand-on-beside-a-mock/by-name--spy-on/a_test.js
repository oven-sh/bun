import { test, mock, spyOn } from "bun:test";
mock.module("./index.mjs", () => ({ unit: "in" }));
test("a", async () => { const space = await import("./area.mjs"); const spy = spyOn(space, "area").mockImplementation(() => "spied"); console.log("a", space.area(2, 3), spy.mock.calls.length); spy.mockRestore(); console.log("a", space.area(2, 3)); });
