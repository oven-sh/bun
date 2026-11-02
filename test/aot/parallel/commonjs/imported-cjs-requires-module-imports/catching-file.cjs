console.log("the catching file begins");
try {
  require("./other-above-the-throw.mjs");
  console.log("the require returns");
} catch (error) {
  console.log("the require throws:", error.message);
}
console.log("the catching file ends");
