// A script declares the name Date, which compiled code takes for a constant: the script is refused.
import vm from "node:vm";
const print = console.log;
const original = Date;
function kind() { return typeof Date; }
function is(value) { return Date === value; }
print([kind(), is(original), is("of the script")].join());
let outcome = "declared";
try {
  vm.runInThisContext("let Date = 'of the script';");
} catch (error) {
  outcome = error.name;
}
print(outcome);
print([kind(), is(original), is("of the script")].join());
print(vm.runInThisContext("[typeof Date, Date === 'of the script'].join()"));
/* Output:
function,true,false
SyntaxError
function,true,false
function,false
*/
