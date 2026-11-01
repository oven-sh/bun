// Built with --obfuscate, the names of the program's functions and classes are not in the executable: `name` is the empty string, and a bound function is called "bound ". A name the program defines itself, a built-in's name and the name of a function made from text at run time stay.
// Flags: --obfuscate
import "../function-names.js";
/* Output:
a declaration: ""
an arrow function in a constant: ""
a named function expression: ""
a class: ""
a method: ""
a static method: ""
a method of a literal: ""
a function in a property: ""
an async function: ""
a generator function: ""
a bound function: "bound "
the constructor of an instance: ""
a class with a static field called name: "kept"
a name the program defines: "given"
a built-in: "max"
a function made from text at run time: "anonymous"
*/
