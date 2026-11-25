import { test } from "bun:test";
const count = async (label, start) => {
  let settled = "";
  const promise = start().then(() => (settled = "resolved"), error => (settled = "rejected " + error.name));
  let turns = 0;
  while (!settled && turns < 400) {
    turns++;
    await null;
  }
  await promise;
  console.log(label, settled, turns < 400 ? turns : "later");
};
test("t", async () => {
  await count("json", () => import("./a.json"));
  await count("json again", () => import("./a.json"));
  await count("toml", () => import("./a.toml"));
  await count("toml again", () => import("./a.toml"));
  await count("yaml", () => import("./a.yaml", { with: { type: "yaml" } }));
  await count("yaml again", () => import("./a.yaml", { with: { type: "yaml" } }));
  await count("json5", () => import("./a.json5"));
  await count("json5 again", () => import("./a.json5"));
});
