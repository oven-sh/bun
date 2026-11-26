console.log("helper");
try {
  require("./mid.mjs");
} catch (error) {
  console.log("helper caught", error.name);
}
Bun.plugin({ name: "p", setup(build) { build.module("@made-up/virtual", () => ({ loader: "object", exports: { v: "plugin" } })); } });
