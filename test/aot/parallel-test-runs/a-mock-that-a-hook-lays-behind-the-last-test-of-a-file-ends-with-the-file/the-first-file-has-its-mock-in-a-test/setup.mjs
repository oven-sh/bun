import { afterEach, jest, vi } from "bun:test";
import { heard } from "./kitchen.mjs";

jest.mock("./kettle.cjs", () => ({ ...jest.requireActual("./kettle.cjs"), sound: "a hum of the preload" }));
heard();

afterEach(() => {
  vi.doMock("./kettle.cjs", () => ({ sound: "a hiss of the hook", cups: 0 }));
});
