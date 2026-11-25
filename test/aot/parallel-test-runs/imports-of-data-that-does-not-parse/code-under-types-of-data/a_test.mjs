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
  await count("json of mjs", () => import("./json.mjs", { with: { type: "json" } }));
  await count("json of mjs again", () => import("./json.mjs", { with: { type: "json" } }));
  await count("toml of mjs", () => import("./toml.mjs", { with: { type: "toml" } }));
  await count("toml of mjs again", () => import("./toml.mjs", { with: { type: "toml" } }));
  await count("json5 of mjs", () => import("./json5.mjs", { with: { type: "json5" } }));
  await count("json5 of mjs again", () => import("./json5.mjs", { with: { type: "json5" } }));
  await count("json of cjs", () => import("./json.cjs", { with: { type: "json" } }));
  await count("json of cjs again", () => import("./json.cjs", { with: { type: "json" } }));
  await count("toml of cjs", () => import("./toml.cjs", { with: { type: "toml" } }));
  await count("toml of cjs again", () => import("./toml.cjs", { with: { type: "toml" } }));
  await count("json5 of cjs", () => import("./json5.cjs", { with: { type: "json5" } }));
  await count("json5 of cjs again", () => import("./json5.cjs", { with: { type: "json5" } }));
});
