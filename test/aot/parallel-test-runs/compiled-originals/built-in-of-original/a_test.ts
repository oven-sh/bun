import { test, vi } from "bun:test";
import { format } from "./json";
vi.mock("./json", async original => ({ ...(await original<any>()), added: 1 }));
vi.mock("./config", async original => ({ ...(await original<any>()), added: 1 }));
test("two originals, and a built-in module below both", async () => {
  console.log("SAID", format(), (await import("./config")).read());
});
