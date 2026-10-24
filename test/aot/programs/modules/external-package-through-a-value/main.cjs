// require() called as a value loads a package that --external names from disk, and a package that the build was not told about.
const load = require;
function join(...parts) {
  return parts.join("-");
}

try {
  console.log(load(join("other", "package")).label);
} catch (error) {
  console.log(error.code, error.message.includes("--external"));
}
console.log(load(join("outside", "package")).label);
