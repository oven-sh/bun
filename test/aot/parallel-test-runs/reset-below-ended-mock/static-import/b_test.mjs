import { test, vi } from "vitest";
import { account } from "./account.mjs";
vi.mock("./target.mjs", () => ({ target: 20 }));
test("second file", () => console.log("SAID b", account()));
