import { vi, test } from "bun:test";
vi.mock("./barrel.js", async original => ({ ...(await original()), x: "over x" }));
import { seen } from "./user.js";
test("a", async () => {
  const ns = await import("./barrel2.js");
  console.log("| CASE a", seen(), ns.x, ns.y, typeof ns.f, Object.keys(ns).sort().join("+"));
});
