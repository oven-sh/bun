import { test } from "bun:test";
const show = (value) => typeof value + " " + JSON.stringify(value);
const loads = [
  ["lenient.txt as json", () => import("./lenient.txt", { with: { type: "json" } })],
  ["strict.txt as json", () => import("./strict.txt", { with: { type: "json" } })],
  ["hexadecimal.txt as json", () => import("./hexadecimal.txt", { with: { type: "json" } })],
  ["tsconfig.json as json", () => import("./tsconfig.json", { with: { type: "json" } })],
  ["package.json as json", () => import("./package.json", { with: { type: "json" } })],
  ["lenient.jsonc as json", () => import("./lenient.jsonc", { with: { type: "json" } })],
  ["strict.jsonc as json", () => import("./strict.jsonc", { with: { type: "json" } })],
  ["lenient.json as jsonc", () => import("./lenient.json", { with: { type: "jsonc" } })],
  ["other.txt as jsonc", () => import("./other.txt", { with: { type: "jsonc" } })],
  ["hexadecimal.json as json5", () => import("./hexadecimal.json", { with: { type: "json5" } })],
  ["hexadecimal-again.json as json", () => import("./hexadecimal-again.json", { with: { type: "json" } })],
  ["blank.txt as json", () => import("./blank.txt", { with: { type: "json" } })],
  ["text.json as text", () => import("./text.json", { with: { type: "text" } })],
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
