// A Map that nobody reads is made of a pair whose first element became an accessor that throws: the module stops there with that error.
try {
  await import("./made.js");
  console.log("ran to its end");
} catch (error) {
  console.log("caught", error?.constructor?.name);
}
