console.log("first begins");
try {
  console.log("first got", require("./back.mjs").back);
} catch (error) {
  console.log("first caught", error.name);
}
console.log("first ends");
