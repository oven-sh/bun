// Object.setPrototypeOf(import.meta, null), the two lines of a crash: the call throws a TypeError.
Object.setPrototypeOf(import.meta, null);
try {
  console.log(typeof import.meta.resolve("./x.mjs"));
} catch (error) {
  console.log(error.constructor.name, error.message);
}
