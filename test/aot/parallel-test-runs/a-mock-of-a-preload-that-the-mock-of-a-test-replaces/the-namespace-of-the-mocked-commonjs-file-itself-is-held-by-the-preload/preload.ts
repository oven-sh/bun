import { vi, mock } from "bun:test";
vi.mock("./lib.cjs", () => ({ kept: "first kept", fn: () => "first fn", added: "first added" }));
globalThis.held = await import("./lib.cjs");
