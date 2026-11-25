import { vi } from "bun:test";
vi.mock("../src/api.mjs", async original => ({ ...(await original()), get: () => "preload" }));
