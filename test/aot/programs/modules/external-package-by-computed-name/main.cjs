// A package that --external names is loaded from disk under a computed name too, though no import names it, and so is a file of the package. So is a package that the build was not told about.
function load(...parts) {
  return require(parts.join("-"));
}

try {
  console.log(load("other", "package").label);
} catch (error) {
  console.log(error.code, error.message.includes("--external"));
}
console.log(load("outside", "package").label);
console.log(load("outside", "package/inner.js").label);
