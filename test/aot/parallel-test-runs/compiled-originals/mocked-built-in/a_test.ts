import { test, vi } from "bun:test";
import { near, top } from "./near";
let calls = 0;
vi.mock("node:crypto", async importOriginal => { calls++; return { ...(await importOriginal<any>()), randomInt: () => "mocked" }; });
vi.mock("fs", () => ({ existsSync: () => "mocked too" }));
vi.mock("./near", async importOriginal => ({ ...(await importOriginal<any>()), added: 1 }));
test("the original reads the mocks of built-in modules", async () => {
  console.log("SAID", near(), top, calls);
  console.log("SAID", (await import("node:crypto")).randomInt(1, 2), calls);
  console.log("SAID", (await vi.importActual<any>("./near")).near());
});
