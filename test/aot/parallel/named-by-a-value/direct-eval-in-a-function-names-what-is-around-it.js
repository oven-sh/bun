function outer() {
  function inner() { return "inner"; }
  const held = () => "held";
  return code => eval(code);
}
const run = outer();
console.log(run("inner()"), run("held()"));
