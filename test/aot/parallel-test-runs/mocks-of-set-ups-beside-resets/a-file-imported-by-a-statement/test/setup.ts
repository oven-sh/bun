import { vi } from "bun:test";

vi.mock("../src/lib.ts", async (importOriginal: () => Promise<any>) => ({ ...(await importOriginal()), price: () => "the set-up's" }));
