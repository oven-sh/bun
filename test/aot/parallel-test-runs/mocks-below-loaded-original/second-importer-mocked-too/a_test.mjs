import { test, vi } from "vitest";
import { entry } from "./entry.mjs";
import { support } from "./support.mjs";
vi.mock("./entry.mjs", async importOriginal => ({ ...(await importOriginal()), added: 1 }));
test("entry", () => console.log("SAID", support, entry()));
