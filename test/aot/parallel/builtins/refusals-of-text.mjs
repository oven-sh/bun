// Text made at run time writes what the build never saw written. Each refusal says what to do.
import vm from "node:vm";
const attempt = (run, ...parts) => {
  try {
    console.log(run(parts.join("")));
  } catch (error) {
    console.log(error.name, error.message.split(" (")[0]);
  }
};
console.log(Array.isArray([]), parseInt("5"));
attempt(eval, "Date.n", "ow = () => 5");
attempt(eval, "Math.ran", "dom = () => 5");
attempt(eval, "Array.prototype.pu", "sh = () => 5");
attempt(eval, "function parse", "Int() {}");
attempt(vm.runInThisContext, "function parse", "Int() {}");
attempt(vm.runInThisContext, "let Ar", "ray = 5");
attempt(vm.runInThisContext, "(function () { let Ar", "ray = 5; function parseInt() { return Array; } return parseInt(); })()");
/* Output:
true 5
TypeError Cannot assign to Date.now because built-in objects are read-only in a compiled executable, and the build didn't see your code assign to this one. Spell out the object and the name where it does, as in Date.now = value
TypeError Cannot assign to Math.random because built-in objects are read-only in a compiled executable, and the build didn't see your code assign to this one. Spell out the object and the name where it does, as in Math.random = value
TypeError Cannot assign to Array.prototype.push because built-in objects are read-only in a compiled executable
TypeError Cannot declare 'parseInt': compiled code treats the global 'parseInt' as a constant, so code from a string can't replace it with a top-level function
TypeError Cannot declare 'parseInt': compiled code treats the global 'parseInt' as a constant, so code from a string can't replace it with a top-level function
SyntaxError Cannot declare 'Array': compiled code treats the global 'Array' as a constant, so a script can't shadow it with a top-level let, const or class
5
*/
