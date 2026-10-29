// The function calls itself in tail position with its rest parameter spread, and the only way out of it is a throw. A validating build compares what the generated code
// does with what the summary of the function says, and once stopped here: everything that this function does goes to the throw.
function thrower(n, ...rest) {
  if (n === 0) throw new RangeError("thrown below " + rest.length);
  return thrower(n - 1, ...rest);
}
for (const list of [[], [1, 2], Array.from({ length: 40 }, (_, i) => i)]) {
  try {
    thrower(10, ...list);
  } catch (error) {
    console.log(error.name, error.message);
  }
}
