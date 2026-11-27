import { vi } from "bun:test";
vi.mock("./lib.cjs", async original => ({ ...(await original()), a: "mocked" }));
