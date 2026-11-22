import { test, vi, mock, jest } from "bun:test";
import { seen } from "./helper.js";
vi.mock("made-up-pkg", async original => ({ ...(await original()), get: () => 0 }));
test("t", () => console.log("SAID", seen(), seen()));
