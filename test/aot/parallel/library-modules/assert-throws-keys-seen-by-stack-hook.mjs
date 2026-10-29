import assert from "node:assert";
let found;
Error.prepareStackTrace = error => {
  found ??= Object.values(error.actual ?? {})[0];
  return "";
};
try {
  assert.throws(
    () => {
      throw Object.create(function () {});
    },
    { constructor: 1 },
  );
} catch {}
try {
  console.log(typeof found === "function" ? found("return 6 * 7")() : "not found");
} catch (error) {
  console.log(error.name);
}

/* Output:
EvalError
*/
