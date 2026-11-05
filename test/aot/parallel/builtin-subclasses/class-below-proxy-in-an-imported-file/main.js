// A class below Proxy, which has no prototype property, stands in an imported file that calls its static method: the file stops where the class is made, with a TypeError.
try {
  await import("./importer.js");
} catch (error) {
  console.log("caught", error?.constructor?.name);
}
