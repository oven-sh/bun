// A script declares the name process, which compiled code takes for a constant: the script is refused.
import vm from "node:vm";
const print = console.log;
const original = process;
function kind() { return typeof process; }
function is(value) { return process === value; }
print([kind(), is(original), is("of the script")].join());
let outcome = "declared";
try {
  vm.runInThisContext("let process = 'of the script';");
} catch (error) {
  outcome = error.name;
}
print(outcome);
print([kind(), is(original), is("of the script")].join());
print(vm.runInThisContext("[typeof process, process === 'of the script'].join()"));
/* Output:
object,true,false
SyntaxError
object,true,false
object,false
*/
