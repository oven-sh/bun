let got;
try {
  got = require("./helper.cjs").load("./wanted.cjs");
} catch {
  got = "fallback";
}
console.log("SAID second", got);
