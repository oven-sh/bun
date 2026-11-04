import { test, jest } from "bun:test";
import { used } from "./user";

jest.mock("./m", () => ({ v: "b" }));

test("jest.mock()", () => {
  console.log("b sees " + used() + "," + (globalThis as any).held());
});
