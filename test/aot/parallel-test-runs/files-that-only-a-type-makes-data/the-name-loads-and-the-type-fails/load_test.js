import { test } from "bun:test";
const show = (value) => typeof value + " " + JSON.stringify(value);
const loads = [
  ["tsconfig.json", () => import("./tsconfig.json")],
  ["tsconfig.json as json", () => import("./tsconfig.json", { with: { type: "json" } })],
];
test("each file by itself", async () => {
  for (const [name, load] of loads) {
    try {
      console.log(name + ": loaded " + show((await load()).default));
    } catch (error) {
      console.log(name + ": " + error.name + ": " + String(error.message).split("\n")[0]);
    }
  }
});
