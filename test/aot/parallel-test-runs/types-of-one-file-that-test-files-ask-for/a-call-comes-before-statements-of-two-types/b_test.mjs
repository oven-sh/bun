import { test } from "bun:test";
const show = (value) => typeof value + ":" + JSON.stringify(value);
const { yaml } = await import("./as-yaml.mjs");
const near = (await import("./conf.txt", { with: { type: "toml" } })).default;
const { held } = await import("./below.mjs");
console.log("yaml loaded first:", show(near), show(held), show(yaml), held === near, yaml === near);
test("runs", () => {});
