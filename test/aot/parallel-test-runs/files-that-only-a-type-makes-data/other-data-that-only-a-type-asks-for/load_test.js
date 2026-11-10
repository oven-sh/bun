import { test } from "bun:test";
const show = (value) => typeof value + " " + JSON.stringify(value);
const loads = [
  ["broken-toml.txt as toml", () => import("./broken-toml.txt", { with: { type: "toml" } })],
  ["sound-toml.txt as toml", () => import("./sound-toml.txt", { with: { type: "toml" } })],
  ["broken-yaml.txt as yaml", () => import("./broken-yaml.txt", { with: { type: "yaml" } })],
  ["sound-yaml.txt as yaml", () => import("./sound-yaml.txt", { with: { type: "yaml" } })],
  ["broken-json5.txt as json5", () => import("./broken-json5.txt", { with: { type: "json5" } })],
  ["sound-json5.txt as json5", () => import("./sound-json5.txt", { with: { type: "json5" } })],
  ["broken-jsonc.txt as jsonc", () => import("./broken-jsonc.txt", { with: { type: "jsonc" } })],
  ["sound-jsonc.txt as jsonc", () => import("./sound-jsonc.txt", { with: { type: "jsonc" } })],
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
