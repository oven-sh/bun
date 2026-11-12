import "./mocks-tax";
import { expect, test, vi } from "bun:test";
import { read } from "./invoice";
test("every kind of export is the mock's", async () => {
  expect(read()).toEqual([1, "mock", "mock", "Mock"]);
  const { rate, label, round, Tax } = await vi.importActual("./tax");
  expect([rate, label, round(), Tax.name]).toEqual([0.2, "real EU", "real", "Tax"]);
});
