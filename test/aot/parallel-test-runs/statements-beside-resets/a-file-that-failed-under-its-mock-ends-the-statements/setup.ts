import { vi } from "bun:test";

vi.mock("./api.ts", async (importOriginal: any) => ({ ...(await importOriginal()), get: () => "set-up" }));
vi.mock("./broken.ts", async (importOriginal: any) => ({ ...(await importOriginal()) }));
