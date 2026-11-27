import { vi } from "bun:test";
vi.mock("./api.mjs", async (original: any) => ({ ...(await original()), get: () => "set-up" }));
