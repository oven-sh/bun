import { vi } from "bun:test";

vi.doMock("./part.mjs", async original => ({ ...(await original()), mocked: "by the preload" }));
