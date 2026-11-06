// A Map that nobody reads is made of a list of pairs that a number was pushed to: the module stops there with a TypeError.
try {
  await import("./made.js");
  console.log("ran to its end");
} catch (error) {
  console.log("caught", error?.constructor?.name);
}
