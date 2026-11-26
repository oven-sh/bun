// @ts-nocheck
Bun.plugin({
  name: "asked for something else",
  setup(build) {
    build.onLoad({ filter: /[.]nothing$/ }, () => ({ contents: "" }));
  },
});
const count = process.argv.length;
console.log(typeof require("bun:path").join, typeof (await import("bun:path")).join, typeof (await import("bun:path", { with: {} })).join, require.resolve("bun:path"));
console.log(typeof require(count > 5 ? "bun:os" : "bun:path").join, typeof (await import(count > 5 ? "bun:os" : "bun:path")).join);
console.log(typeof (await import(count > 5 ? "bun:os" : "bun:path", { with: {} })).join, require.resolve(count > 5 ? "bun:os" : "bun:path"));
