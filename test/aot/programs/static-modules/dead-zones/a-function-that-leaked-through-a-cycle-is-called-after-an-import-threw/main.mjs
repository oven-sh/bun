// thrower.mjs throws in front of its binding, so a.mjs never runs. leak.mjs, on a cycle with a.mjs, has kept a function of a.mjs that reads that binding.
try {
  await import("./a.mjs");
} catch (error) {
  console.log("caught", error.message);
}
try {
  console.log("leaked", globalThis.leaked());
} catch (error) {
  console.log("leaked", error.constructor.name);
}
