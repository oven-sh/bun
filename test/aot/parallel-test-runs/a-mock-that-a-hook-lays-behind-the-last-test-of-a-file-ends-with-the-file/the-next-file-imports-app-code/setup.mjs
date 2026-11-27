import { afterEach, jest, mock } from "bun:test";
import { shines } from "./tower.mjs";

jest.mock("./lamp.cjs", () => ({ ...jest.requireActual("./lamp.cjs"), color: "amber, by the preload" }));
shines();

afterEach(() => {
  mock.module("./lamp.cjs", () => ({ color: "red, by the hook" }));
});
