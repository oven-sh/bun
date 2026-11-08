// A package that --external names is loaded from disk under a computed name too, though no import names it, and so is a file of the package. A package that the build was not told about is code outside the executable, and is refused.
// Flags: --external outside-package
function load(...parts) {
  return require(parts.join("-"));
}

try {
  console.log(load("other", "package").label);
} catch (error) {
  console.log(error.code, error.message.includes("--aot-allow-code-from-disk"));
}
console.log(load("outside", "package").label);
console.log(load("outside", "package/inner.js").label);
/* Output:
MODULE_NOT_FOUND true
outside
inner
*/
