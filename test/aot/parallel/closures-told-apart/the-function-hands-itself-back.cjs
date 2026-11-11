function run(f) { return f(); }
function make(k) {
  const byName = run(function self() { return self; });
  const byArguments = run(function () { return arguments.callee; });
  return [typeof byName, byName === run(byName), typeof byArguments, byArguments === byArguments(), k];
}
console.log(make(1).join(), make(2).join());
