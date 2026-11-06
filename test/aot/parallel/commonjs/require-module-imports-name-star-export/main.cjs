// Require of a module that imports a name through a star export of a file that never stores it.
try {
  require("./importer.mjs");
} catch (error) {
  console.log("caught", error.name);
}
