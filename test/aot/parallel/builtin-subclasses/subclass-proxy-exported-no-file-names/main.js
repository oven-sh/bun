// A class below Proxy, which has no prototype property, is exported by a file whose importer names another export: the file stops where the class is made, with a TypeError.
try {
  await import("./importer.js");
} catch (error) {
  console.log("caught", error?.constructor?.name);
}
