// Try finally overrides return: compiled answers as plain.
function f(n) {
  try {
    if (n === 0) return "try";
    if (n === 1) throw new Error("x");
    return "end";
  } catch (e) {
    return "catch";
  } finally {
    if (n === 2) return "finally";
  }
}
console.log(f(0), f(1), f(2), f(3));
