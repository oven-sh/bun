import { test, vi, mock, jest } from "bun:test";
import { get, late } from "made-up-pkg";
vi.mock("made-up-pkg", async original => ({ ...(await original()), get: () => 0 }));
test("t", () => console.log("SAID", get(), late));
