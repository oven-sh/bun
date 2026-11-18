see("waits begins");
let didSetUp = false;
globalThis.built = Bun.build({
  entrypoints: ["./built.js"],
  plugins: [
    {
      name: "waits",
      async setup() {
        see("setup begins");
        for (let round = 0; round < 4; round++) await new Promise(resolve => setImmediate(resolve));
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
  see("Bun.build() did not wait for setup() of its plugin: no call of import() is made again inside this file");
see("waits ends");
exports.name = "waits";
