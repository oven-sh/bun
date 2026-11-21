import { vi } from "bun:test";

vi.mock("lib", async (importOriginal: () => Promise<any>) => ({ ...(await importOriginal()), price: () => "the set-up's" }));
