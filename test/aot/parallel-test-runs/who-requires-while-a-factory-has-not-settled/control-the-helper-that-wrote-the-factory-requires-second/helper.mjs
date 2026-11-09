import { vi } from "bun:test";
export const byHelper = name => { try { return require(name).seen; } catch (error) { return "threw " + error.name; } };
export const layMock = () => vi.doMock("./pump.mjs", async () => { await new Promise(done => setTimeout(done, 10)); return { flow: "stand-in" }; });
