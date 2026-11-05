console.log("b sees", require("./c.mjs").v);
try {
  console.log("caught sees", require("./c.mjs").v);
} catch (error) {
  console.log("caught fails", error.name);
}
