see("waits begins");
globalThis.held = store.run("held", () => import("./leaf.mjs"));
globalThis.built = Bun.build({
  entrypoints: [__dirname + "/built.js"],
  plugins: [
    {
      name: "waits",
      async setup() {
        see("setup begins");
        await 0;
        see("setup ends");
      },
    },
  ],
}).then(
  () => see("build settled"),
  () => see("build failed"),
);
see("waits ends");
exports.name = "waits";
