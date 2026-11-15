import { test, vi, mock, jest } from "bun:test";
import { count, bump, get } from "made-up-pkg";
vi.mock("made-up-pkg", async original => ({ ...(await original()), get: () => 0 }));
test("a", () => { bump(); console.log("SAID a", count, get()); });
