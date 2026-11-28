console.log("helper");
try {
  require("./mid.mjs");
} catch (error) {
  console.log("helper caught", error.name);
}
Bun.plugin({ name: "p", setup(build) { build.onResolve({ filter: /^@made-up\/virtual$/ }, () => ({ path: __dirname + "/other.mjs" })); } });
