// Nothing that the entry point imports awaits. first.cjs requires a module that does, and does not catch what require() throws.
import "./first.cjs";
import "./second.cjs";
console.log("main begins");
setTimeout(() => console.log("the end"), 1);
/* Output:
first begins
waits sees default,early
second runs function
main begins
the end
*/
