see("waits begins");
let didSetUp = false;
globalThis.built = Bun.build({
  entrypoints: ["./built.js"],
  plugins: [
    {
      name: "waits",
      async setup() {
        see("setup begins");
        await 0;
        see("setup ends");
        didSetUp = true;
      },
    },
  ],
}).then(
  () => see("build settled"),
  () => see("build failed"),
);
if (!didSetUp)
  console.log("Bun.build() did not wait for setup() of its plugin: no call of import() is made again inside this file");
see("waits ends");
exports.name = "waits";
