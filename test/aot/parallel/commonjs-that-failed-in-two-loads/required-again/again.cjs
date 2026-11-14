try {
  console.log("got", require("./fails.cjs"));
} catch (error) {
  console.log("caught", error.message);
}
exports.value = 2;
