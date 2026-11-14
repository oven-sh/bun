import { vi } from "bun:test";
vi.mock("./a1.mjs", async original => ({ v: "ma" + (await original()).v }));
export const v = await Promise.race([import("./a1.mjs").then(found => found.v), new Promise(done => setTimeout(done, 30, "late"))]);
