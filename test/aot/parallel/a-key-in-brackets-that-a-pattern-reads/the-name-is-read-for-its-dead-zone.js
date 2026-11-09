// The constant is read where the pattern stands: in front of its declaration that throws.
function early() {
  const { [LATE]: held } = { late: 1 };
  return held;
}
try {
  console.log(early());
} catch (error) {
  console.log(error instanceof ReferenceError, error.name);
}
const LATE = "late";
console.log(early());
