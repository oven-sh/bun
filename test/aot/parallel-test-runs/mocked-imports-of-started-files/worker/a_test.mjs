import { test, vi } from "vitest";
import { all } from "./all.mjs";
vi.mock("./mocked.mjs", async importOriginal => ({ ...(await importOriginal()), added: "mocked" }));
test("reads", () => console.log("SAID", all()));
