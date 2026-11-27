import { vi } from "bun:test";
vi.mock("./api.mjs", async () => ({ ...(await vi.importActual<any>("./api.mjs")), get: () => "set-up" }));
