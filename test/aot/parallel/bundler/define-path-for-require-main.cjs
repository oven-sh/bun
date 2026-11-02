// A `--define` of `require.main` whose value is a dotted path reads a member of the parameter that has its first name, not of the global of that name.
// Flags: --define require.main=holder.main
globalThis.holder = { main: "the global" };
function f(holder) {
  return require.main;
}
console.log(f({ main: "the parameter" }));
