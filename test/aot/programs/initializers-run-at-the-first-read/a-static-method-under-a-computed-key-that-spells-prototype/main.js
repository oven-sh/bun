// A class that nobody reads has a static method under a computed key that spells "prototype": the module stops there with a TypeError.
try {
  await import("./made.js");
  console.log("ran to its end");
} catch (error) {
  console.log("caught", error?.constructor?.name);
}
