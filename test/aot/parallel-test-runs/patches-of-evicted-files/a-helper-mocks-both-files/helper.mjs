import { vi, jest, mock } from "bun:test";
vi.mock("./top.mjs", async () => ({ ...(await vi.importActual("./top.mjs")), top: () => "mocked top" }));
vi.mock("./low.mjs", async original => ({ ...(await original()), low: () => "mocked low" }));
export const load = () => import("./user.mjs");
