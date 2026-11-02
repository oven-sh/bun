// `a` and `b` import each other, and `a` throws behind its await after `b` has run: whoever reads the deferred namespace object of `b` is thrown what `a` threw.
let importError;
await import("./a.mjs").catch(error => (importError = error));
console.log(importError.message);
const { later } = await import("./holder.mjs");
for (let turn = 0; turn < 2; turn++) {
  try {
    console.log(later.value);
  } catch (error) {
    console.log(error === importError, error.message);
  }
}
try {
  console.log(Object.keys(later));
} catch (error) {
  console.log(error === importError, error.message);
}
console.log(typeof later, typeof later.then, Object.prototype.toString.call(later));
await import("./b.mjs").then(
  namespace => console.log("import() gives", namespace.value),
  error => console.log("import() rejects", error === importError),
);
