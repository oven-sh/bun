import { vi } from "bun:test";
globalThis.calls = 0;
vi.mock("./tax.js", async importOriginal => (globalThis.calls++, console.log("| the first factory"), { ...(await importOriginal()), currency: "GBP" }));
