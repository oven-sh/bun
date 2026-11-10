import { vi } from "bun:test";
vi.mock("./tax.js", async importOriginal => { console.log("SAID factory"); const real = await importOriginal(); console.log("SAID the factory has", Object.keys(real).join()); return { ...real, currency: "USD" }; });
console.log("SAID mocks-tax ends");
export const laid = true;
