import { vi } from "bun:test";
vi.mock("./lib.cjs", async original => ({ ...(await original()), a: "mocked" }));
globalThis.requiredByThePreload = require("./lib.cjs");
