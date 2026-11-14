import { vi } from "bun:test";
vi.mock("./region", async importOriginal => ({ ...(await importOriginal()) }));
