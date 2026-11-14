import { mock, test, vi } from "bun:test";
import * as root from "./root.mjs";
test("t", () => { console.log("SAID", typeof root.r, globalThis.R.splice(0).join()); });
