let color;
try {
  color = require("a-package-that-nobody-has-installed-here");
} catch {
  color = require("./plain.cjs");
}
console.log(color.red("text"));
