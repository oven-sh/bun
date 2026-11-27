import { vi } from "bun:test";
import { start } from "./start.mjs";
vi.mock("./routes.mjs", async importOriginal => ({ ...(await importOriginal()), added: 1 }));
vi.mock("./access.mjs", async importOriginal => ({ ...(await importOriginal()), added: 1 }));
export const launch = () => start();
