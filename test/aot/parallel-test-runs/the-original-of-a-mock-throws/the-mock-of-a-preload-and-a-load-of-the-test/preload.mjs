import { vi } from "bun:test";
vi.mock("./part.mjs", async original => { console.log("SAID f<"); return { ...(await original()), w: 1 }; });
