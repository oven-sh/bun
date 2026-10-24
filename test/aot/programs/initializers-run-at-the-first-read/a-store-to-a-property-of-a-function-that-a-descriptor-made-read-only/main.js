// Strict code stores to a property of a function that a descriptor made read-only, and nobody reads the function: the module stops there with a TypeError.
try {
  await import("./made.js");
  console.log("ran to its end");
} catch (error) {
  console.log("caught", error?.constructor?.name);
}
