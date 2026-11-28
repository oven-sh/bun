import { test } from "bun:test";
import * as text from "./data.toml" with { type: "text" };
import * as yaml from "./data.toml" with { type: "yaml" };
import * as toml from "./data.toml" with { type: "toml" };
import * as untyped from "./data.toml";
import { fromOther } from "./other.mjs";
test("a", async () => {
  console.log(JSON.stringify([text.default, yaml.default, toml.default, untyped.default, fromOther]));
  console.log(text.default === yaml.default, toml.default === untyped.default, require("./data.toml") === untyped.default);
  console.log(JSON.stringify((await import("./data.toml", { with: { type: "text" } })).default));
  console.log(JSON.stringify((await import("./data.toml", { with: { type: "yaml" } })).default));
  console.log((await import("./data.toml", { with: { type: "toml" } })).default === untyped.default);
});
