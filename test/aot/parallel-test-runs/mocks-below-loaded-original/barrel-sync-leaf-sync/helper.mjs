import { vi } from "vitest";
vi.mock("./barrel.mjs", () => ({ barrel: () => "mocked barrel", leafOfBarrel: () => "leaf of mock" }));
