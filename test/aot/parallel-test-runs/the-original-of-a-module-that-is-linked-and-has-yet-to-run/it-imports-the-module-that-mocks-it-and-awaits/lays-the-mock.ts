import { vi } from "bun:test";
vi.mock("./tax", async importOriginal => ({ ...(await importOriginal<typeof import("./tax")>()), currency: "USD" }));
export const laid = true;
