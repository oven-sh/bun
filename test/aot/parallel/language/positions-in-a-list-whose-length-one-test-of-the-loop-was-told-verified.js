// Flags: --aot-check=verify-each-pass
// `[...[a, ...r]]` copies a pair twice, each time in a loop over a list of known length. Once the lengths are constants, nothing is left in the function that could leave a loop,
// but one test of a position has been told the length and the other tests of its loop can be told the same. The pass that tells them was left out.
function overEntries(n) {
  const held = Object.entries({ a: n, b: n + 1 });
  let t = "";
  for (const [...[a, ...r]] of held) { t += a + ":" + r[0] + ";"; }
  return t;
}
function overPairs(n) {
  let t = "";
  for (const [...[a, ...r]] of [["a", n], ["b", n + 1, n + 2]]) t += a + ":" + r[0] + "," + r.length + ";";
  return t;
}
console.log(overEntries(1), overEntries(2));
console.log(overPairs(1), overPairs(2));
