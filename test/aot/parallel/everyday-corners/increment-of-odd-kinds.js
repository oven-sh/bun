// Increment of odd kinds: compiled answers as plain.
function inc(x) {
  let v = x;
  v++;
  return v;
}
for (const x of ["1", "a", null, undefined, true, [], [5], {}, 1n, 2147483647, -0.5]) {
  try {
    console.log(String(inc(x)));
  } catch (e) {
    console.log(e.constructor.name);
  }
}
