// A `--define` whose value is `arguments` is the arguments object of the function: a store through it reaches the parameter, and a store to the parameter reaches it.
// Flags: --define ARGS=arguments
function f(a) {
  ARGS[0] = "stored through arguments";
  return a;
}
console.log(f("the argument"));
function g(a) {
  a = "stored to the parameter";
  return ARGS[0];
}
console.log(g("the argument"));
function callee() {
  return typeof ARGS.callee;
}
console.log(callee());
