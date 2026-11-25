import { jest, test } from "bun:test";
import { total } from "./totals";
jest.mock("./rates", () => ({ rate: () => "mock" }));
globalThis.runs = (globalThis.runs ?? 0) + 1;
test("b", () => console.log("b", total(), "run", globalThis.runs));
