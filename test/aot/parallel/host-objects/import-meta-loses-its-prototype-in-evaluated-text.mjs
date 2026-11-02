// Text that is evaluated at run time finds import.meta on the global object and takes its prototype away.
globalThis.held = import.meta;
console.log(typeof import.meta.resolve("./x.mjs"), typeof import.meta.url);
(0, eval)("Object.setPrototypeOf(held, { url: 5 })");
try {
  console.log(typeof import.meta.url, import.meta.url + 1);
  console.log(typeof import.meta.resolve("./x.mjs"));
} catch (error) {
  console.log(error.constructor.name, error.message);
}
