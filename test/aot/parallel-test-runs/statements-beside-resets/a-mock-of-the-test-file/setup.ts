import { jest, vi } from "bun:test";

jest.mock("./api.mjs", async () => ({ ...(await vi.importActual<any>("./api.mjs")), get: () => "set-up" }));
