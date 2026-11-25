import { test, vi } from "vitest";
import { all } from "./all.mjs";
vi.mock("./mocked.mjs", async importOriginal => ({ ...(await importOriginal()), added: "mocked" }));
vi.mock("./outer.mjs", async importOriginal => ({ ...(await importOriginal()), added: "outer" }));
test("reads", () => console.log("SAID", all()));
