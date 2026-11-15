import { vi } from "bun:test";
globalThis.callsOfTheFactory = 0;
vi.mock("./lib.cjs", async original => { globalThis.callsOfTheFactory++; return { ...(await original()), a: "mocked" }; });
