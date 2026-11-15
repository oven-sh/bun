import { vi } from "vitest";
import "./entry.mjs";
import "./reader.mjs";
vi.mock("./entry.mjs", async importOriginal => ({ ...(await importOriginal()), added: 1 }));
vi.mock("./barrel.mjs", async importOriginal => ({ ...(await importOriginal()), added: 1 }));
vi.mock("./state.mjs", async importOriginal => ({ ...(await importOriginal()), added: 1 }));
