try {
  const got = import.meta.require("./lib.mjs");
  console.log("SAID dep required a " + typeof got);
  console.log("SAID its keys " + Object.keys(got).sort().join());
} catch (error) {
  console.log("SAID dep threw " + error.name + ": " + String(error.message).replace(/"[^"]*\//, '"').slice(0, 90));
}
export const value = "real";
