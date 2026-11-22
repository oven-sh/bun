import { test, vi } from "bun:test";
vi.mock("pkg");
const ask = async () => { try { return typeof (await import("pkg")).go; } catch (error) { return error.name; } };
const now = () => { try { return typeof require("pkg").go; } catch (error) { return error.name; } };
test("a", async () => {
  const said = [];
  said.push(now());
  said.push(await ask());
  console.log("SAID a", said.join(), globalThis.bodies);
});
test("b", () => { console.log("SAID b runs"); });
