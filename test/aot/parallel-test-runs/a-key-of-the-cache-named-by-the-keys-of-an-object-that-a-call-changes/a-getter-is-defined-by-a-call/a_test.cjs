const { test } = require("bun:test");
globalThis.loads = 0;
const made = {
  x() {
    return 1;
  },
};
made.__defineGetter__("y", () => () => 2);
require("./parts/x.cjs");
require("./parts/y.cjs");
for (const name in made) {
  made[name]();
  delete require.cache[require.resolve(`./parts/${name}.cjs`)];
}
test("t", () => console.log("SAID", require("./parts/y.cjs").number, globalThis.loads));
