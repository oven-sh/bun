import { test } from "bun:test";
const show = (value) => typeof value + ":" + JSON.stringify(value);
const near = (await import("./conf.txt", { with: { type: "toml" } })).default;
const { held } = await import("./below.mjs");
const { yaml } = await import("./as-yaml.mjs");
console.log("toml called first:", show(near), show(held), show(yaml), held === near, yaml === near);
test("runs", () => {});
