import { it } from "bun:test";

it("reportError", () => {
  reportError(new Error("reportError Test!"));
});
