console.log("first begins");
try {
  console.log("first got", Object.keys(require("./back.mjs")).join());
} catch (error) {
  console.log("first caught", error.message);
}
console.log("first ends");
