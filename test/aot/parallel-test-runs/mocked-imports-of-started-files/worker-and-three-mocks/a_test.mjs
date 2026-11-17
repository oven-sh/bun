import { test, vi } from "vitest";
import { all } from "./all.mjs";
vi.mock("./mocked.mjs", async importOriginal => ({ ...(await importOriginal()), added: "mocked" }));
vi.mock("./second.mjs", async importOriginal => ({ ...(await importOriginal()), added: "second" }));
vi.mock("./inner.mjs", async importOriginal => ({ ...(await importOriginal()), added: "inner" }));
test("reads", () => console.log("SAID", all()));
