import { vi } from "bun:test";
vi.mock("./part.mjs", async orig => { globalThis.calls = (globalThis.calls ?? "") + "p "; return { ...(await orig()), g: "p" }; });
