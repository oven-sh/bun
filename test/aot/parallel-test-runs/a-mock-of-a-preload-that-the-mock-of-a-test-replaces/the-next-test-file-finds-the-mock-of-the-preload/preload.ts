import { vi, mock } from "bun:test";
vi.mock("./lib.ts", () => ({ kept: "first kept", fn: () => "first fn", added: "first added" }));
globalThis.held = await import("./barrel.ts");
