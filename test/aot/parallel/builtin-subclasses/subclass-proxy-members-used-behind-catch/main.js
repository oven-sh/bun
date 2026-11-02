// A class below Proxy, which has no prototype property, whose members are used behind a catch: the module stops where the class is made, with a TypeError.
try {
  await import("./made.js");
  console.log("ran to its end");
} catch (error) {
  console.log("caught", error?.constructor?.name);
}
