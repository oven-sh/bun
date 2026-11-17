import { test, vi, mock, jest } from "bun:test";
import * as all from "made-up-pkg";
vi.mock("made-up-pkg", async original => ({ get: (await original()).get }));
test("t", () => console.log("SAID", Object.keys(all).sort().join(), all.get()));
