// The initializer of a `const` that is used once, by the `return` right behind it, is in tail position, also where a `--define` whose value is one name spells that use: a recursion a million calls deep comes back.
// Flags: --define NAME=target
function loop(n) {
  if (n === 0) return "done";
  const target = loop(n - 1);
  return NAME;
}
console.log(loop(1e6));
