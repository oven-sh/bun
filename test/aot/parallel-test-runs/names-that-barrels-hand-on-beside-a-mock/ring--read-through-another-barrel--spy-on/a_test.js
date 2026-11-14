import { test, mock, spyOn } from "bun:test";
mock.module("./index.mjs", () => ({ unit: "in" }));
test("a", async () => { const api = await import("./api.mjs"); const spy = spyOn(api, "area").mockImplementation(() => "spied"); console.log("a", api.area(2, 3), spy.mock.calls.length); spy.mockRestore(); console.log("a", api.area(2, 3)); });
