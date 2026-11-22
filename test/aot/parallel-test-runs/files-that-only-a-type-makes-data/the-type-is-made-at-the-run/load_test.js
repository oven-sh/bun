import { test } from "bun:test";
import rows from "./rows.json";
const ending = globalThis.neverSet ? "x" : "";
const loads = [
  ["rows.json as text", () => import("./rows.json", { with: { type: "text" + ending } })],
  ["rows.json as json", () => import("./rows.json", { with: { type: "json" + ending } })],
  ["rows.json as toml", () => import("./rows.json", { with: { type: "toml" + ending } })],
  ["rows.txt as toml", () => import("./rows.txt", { with: { type: "toml" + ending } })],
];
test("each type by itself", async () => {
  for (const [name, load] of loads) {
    try {
      const typed = await load();
      console.log(name + ": loaded " + JSON.stringify(typed.default) + " " + (typed.default === rows));
    } catch (error) {
      console.log(name + ": threw " + error.name);
    }
  }
});
