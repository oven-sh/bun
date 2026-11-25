import { vi } from "bun:test";

vi.mock("./db.ts", async (importOriginal: any) => ({ ...(await importOriginal()), get: () => "set-up" }));
