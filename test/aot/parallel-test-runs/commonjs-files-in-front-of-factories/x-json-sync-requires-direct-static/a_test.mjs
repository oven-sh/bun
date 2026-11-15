import { jest, mock, test, vi } from "bun:test";
vi.mock("./m1.json", () => { globalThis.R.push("factory"); return { v: "mock", default: { v: "mock" } }; });
import * as root from "./root.mjs";
test("t", () => { console.log("SAID", typeof root.r, globalThis.R.splice(0).join()); });
