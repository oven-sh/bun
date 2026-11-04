// Throw in finally replaces: compiled answers as plain.
function f() {
  try {
    throw new Error("first");
  } finally {
    throw new Error("second");
  }
}
try {
  f();
} catch (e) {
  console.log(e.message);
}
