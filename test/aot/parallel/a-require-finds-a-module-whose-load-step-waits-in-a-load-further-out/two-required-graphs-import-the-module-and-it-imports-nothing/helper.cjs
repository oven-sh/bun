let got = "the fallback";
try {
  got = require("./leaf.mjs").leaf;
} catch (error) {
  got += " (" + error.constructor.name + ")";
}
module.exports = "helper: " + got;
