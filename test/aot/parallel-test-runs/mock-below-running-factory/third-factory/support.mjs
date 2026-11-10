import "./inner-mock.mjs";
import { vi } from "bun:test";
import { outer } from "./outer.mjs";
vi.mock("./third.mjs", async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, third: () => "mocked " + actual.third() };
});
vi.mock("./middle.mjs", async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, middle: () => "mocked " + actual.middle() };
});
vi.mock("./outer.mjs", async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, outer: () => "mocked " + actual.outer() };
});
export const launch = () => outer();
