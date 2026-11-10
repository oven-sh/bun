import { test, vi, mock, jest } from "bun:test";
import { get, Bus } from "made-up-pkg";
vi.mock("made-up-pkg", async original => ({ ...(await original()), extra: 1 }));
test("t", () => console.log("SAID", get(), typeof new Bus().on));
