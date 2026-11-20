import { test, vi } from "bun:test";
import { sold } from "./sale.mjs";
vi.mock("./tax.mjs", async () => ({ ...(await vi.importActual("./tax.mjs")), rate: "b" }));
test("b", () => {
  console.log("b", sold());
});
