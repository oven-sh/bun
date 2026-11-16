// The name is deleted before the file that reads it is loaded: the declaration throws though nothing reads its variable.
delete globalThis.setImmediate;
try {
  await import("./reads.mjs");
} catch (error) {
  console.log(error.constructor.name);
}
console.log("main ends");
