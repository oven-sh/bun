import { vi } from "vitest";
vi.mock("./barrel.mjs", async () => ({ barrel: () => "mocked barrel", leafOfBarrel: () => "leaf of mock" }));
