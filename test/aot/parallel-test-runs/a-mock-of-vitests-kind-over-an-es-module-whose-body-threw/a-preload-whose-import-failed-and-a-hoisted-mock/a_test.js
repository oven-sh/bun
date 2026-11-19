import { test, vi } from "bun:test";
import { get } from "./part.mjs";
const word = "mocked";
vi.mock("./part.mjs", () => ({ get: () => word }));
test("t", () => console.log("SAID", get()));
