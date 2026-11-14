// A package marked --external is interpreted. It has require, module and the cache, and every built-in module; its module.parent stands in for the file that required it. The built-in objects it finds as code from a string does:
// what compiled code relies on can't be replaced, whoever tries, so the compiler goes on relying on it in a program with such a package. What nobody relies on can be added and replaced.
// Flags: --external outside-package
const outside = require("outside-package");
const print = console.log;
print("before:", typeof Date.now(), [3, 1, 2].sort().join(), typeof process.pid, typeof performance.now());
for (const line of outside.patch()) print(line);
print("after:", typeof Date.now(), [3, 1, 2].sort().join(), typeof process.pid, typeof performance.now());
print("added by the package:", globalThis.addedByThePackage, typeof process.addedByThePackage);
print("built-in modules in the package:", outside.usesModules());
print("the program seen from the package:", outside.seesTheProgram(module));
/* Output:
before: number 1,2,3 number number
globalThis.Date = ..: TypeError
Date.now = ..: TypeError
Array.prototype.sort = ..: TypeError
globalThis.process = ..: TypeError
globalThis.addedByThePackage = ..: done
process.addedByThePackage = ..: done
after: number 1,2,3 number number
added by the package: 1 function
built-in modules in the package: function function b.txt
the program seen from the package: object false object
*/
