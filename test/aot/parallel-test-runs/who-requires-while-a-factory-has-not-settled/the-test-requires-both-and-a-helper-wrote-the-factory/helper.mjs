import { vi } from "bun:test";
export const byHelper = name => { try { return require(name).seen; } catch (error) { return "threw " + error.name; } };
export const layMock = () => vi.doMock("./pump.mjs", async () => { globalThis.hasBegun = true; await globalThis.gate.promise; globalThis.settles.resolve(); return { flow: "stand-in" }; });
