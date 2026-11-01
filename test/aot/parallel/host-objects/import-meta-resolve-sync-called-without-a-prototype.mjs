// The same for resolveSync, through Reflect.setPrototypeOf.
console.log(Reflect.setPrototypeOf(import.meta, null));
try {
  console.log(typeof import.meta.resolveSync("./x.mjs"));
} catch (error) {
  console.log(error.constructor.name, error.message);
}
