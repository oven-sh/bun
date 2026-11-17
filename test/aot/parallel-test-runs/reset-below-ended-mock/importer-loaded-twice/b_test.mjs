import { test, vi } from "vitest";
import { account } from "./account.mjs";
vi.mock("./target.mjs", async original => ({ ...(await original()) }));
test("second file", () => console.log("SAID b", account()));
