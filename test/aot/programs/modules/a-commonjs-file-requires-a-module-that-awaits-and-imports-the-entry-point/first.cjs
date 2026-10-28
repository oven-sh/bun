console.log("first begins");
try {
  console.log("first got", Object.keys(require("./waits.mjs")).join());
} catch (error) {
  console.log("first caught", error.name);
}
console.log("first ends");
