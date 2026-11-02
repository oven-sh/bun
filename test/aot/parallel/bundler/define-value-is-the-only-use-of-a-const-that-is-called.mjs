// Where a `--define` whose value is one name spells the only use of a `const` and that use is called, the TypeError quotes the initializer of the `const` as what is no function, also where the value is longer than the defined name.
// Flags: --define NAME=target
function make() {
  return 1;
}
function call() {
  const target = make();
  return NAME();
}
try {
  call();
} catch (error) {
  console.log(error.message);
}
