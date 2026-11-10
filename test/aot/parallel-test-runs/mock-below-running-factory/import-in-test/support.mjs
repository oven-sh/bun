import { vi } from "bun:test";
import { outer } from "./outer.mjs";
vi.mock("./inner.mjs", async importOriginal => {
  const actual = await importOriginal();
  return { ...actual, inner: () => "mocked " + actual.inner() };
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
