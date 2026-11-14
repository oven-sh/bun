import { jest, mock, test, vi } from "bun:test";
vi.mock("./m1.cjs", { spy: true });
import * as root from "./root.mjs";
test("t", () => { console.log("SAID", typeof root.r, globalThis.R.splice(0).join()); });
