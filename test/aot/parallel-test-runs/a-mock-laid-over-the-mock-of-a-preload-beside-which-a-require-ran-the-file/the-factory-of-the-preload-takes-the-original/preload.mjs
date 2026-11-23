import { vi, mock } from "bun:test";
vi.mock("./part.cjs", async real => ({ ...(await real()), a: "of the preload" }));
globalThis.requiredByThePreload = require("./part.cjs");
