console.log("second begins");
try {
  console.log("second got", require("./main.mjs").answer);
} catch (error) {
  console.log("second caught", error.name);
}
console.log("second ends");
