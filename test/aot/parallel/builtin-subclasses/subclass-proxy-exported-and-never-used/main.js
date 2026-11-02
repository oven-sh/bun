// A class below Proxy, which has no prototype property, is exported and never used: the module stops where the class is made, with a TypeError.
try {
  await import("./importer.js");
} catch (error) {
  console.log("caught", error?.constructor?.name);
}
