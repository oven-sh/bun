import { mock, test, vi } from "bun:test";
import { rate } from "./rates.mjs";

test("b", async () => {
  console.log("b", rate(), globalThis.rateOfA?.());
  mock.module("./rates.mjs", () => ({ rate: () => "mocked" }));
  console.log("b mocks", rate(), globalThis.rateOfA?.(), (await import("./rates.mjs")).rate());
  vi.resetModules();
  console.log("b resets", rate(), globalThis.rateOfA?.());
});
