// DECLARED: docs/compiler/compatibility.mdx, "Smaller differences". What runs evaluates an enum in a function that has the object as a parameter of the enum's name: `bun <file>` and `bun build --compile` hand keep()
// the enum's object and print {"Low":9} {"1":"Low","2":"Middle","3":"High","Low":1,"Middle":2,"High":3}. Compiled, the name finds the variable. It shows only behind a store to the name, which tsc refuses: TS2628.
let kept: any;
// @ts-ignore
function swap() { Level = { Low: 9 }; return 1; }
function keep(it: any) { kept = it; return 3; }
enum Level { Low = swap(), Middle = Low + 1, High = keep(Level) }
console.log(JSON.stringify(Level), JSON.stringify(kept));
/* Output:
{"Low":9} {"Low":9}
*/
