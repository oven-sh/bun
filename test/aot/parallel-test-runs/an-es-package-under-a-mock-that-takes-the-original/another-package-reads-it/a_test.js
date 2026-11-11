import { test, vi, mock, jest } from "bun:test";
import { value, helper } from "made-up-dep";
import { seen } from "made-up-reads";
vi.mock("made-up-dep", async original => ({ ...(await original()), value: () => "mocked" }));
test("t", () => console.log("SAID", seen(), value(), helper()));
