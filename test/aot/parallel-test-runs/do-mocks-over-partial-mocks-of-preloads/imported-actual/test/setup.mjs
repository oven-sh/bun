import { vi } from "bun:test";
vi.mock("../src/api.mjs", async () => ({ ...(await vi.importActual("../src/api.mjs")), get: () => "preload" }));
