// The transpiler of `bun run` drops the class: "undefined".
function probe() {
  return typeof Later;
  class Later {}
}
try {
  console.log(probe());
} catch (error) {
  console.log(error.name);
}
/* Output:
ReferenceError
*/
