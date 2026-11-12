console.log("third begins");
try {
  console.log("third got", require("./side.mjs").side);
} catch (error) {
  console.log("third caught", error.name);
}
console.log("third ends");
