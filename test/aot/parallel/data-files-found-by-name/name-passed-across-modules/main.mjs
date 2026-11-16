const lib = import.meta.require("./lib/load.cjs");
try {
  console.log(JSON.stringify(lib.load("./good.json")));
} catch (error) {
  console.log("threw", error.name);
}
try {
  console.log(JSON.stringify(lib.load("./broken.json")));
} catch (error) {
  console.log("threw", error.name);
}
