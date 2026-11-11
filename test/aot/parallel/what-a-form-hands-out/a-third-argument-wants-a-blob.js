// With three arguments the second must be a Blob, were the third undefined. With fewer than two there are not enough.
const form = new FormData();
for (const operands of [
  ["a", "b", undefined],
  ["a", "b", "c"],
  ["a", {}, "c"],
  ["a"],
  [],
  ["a", null],
  ["a", undefined],
]) {
  for (const method of ["append", "set"]) {
    try {
      console.log(`${method} ${operands.length}: ${form[method](...operands)} ${form.get("a")}`);
    } catch (error) {
      console.log(`${method} ${operands.length}: ${error.name}: ${error.message}`);
    }
  }
}
for (const method of ["get", "getAll", "has", "delete"]) {
  try {
    form[method]();
  } catch (error) {
    console.log(`${method}: ${error.name}`);
  }
}
