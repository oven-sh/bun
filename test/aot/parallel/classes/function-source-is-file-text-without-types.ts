// The source of a function or a class is the text of the file without the types. `bun <file>` prints what its transpiler wrote: one member a line, `new Map` for `new Map()`.
// prettier-ignore
class Named { name = "named"; items: string[] = []; table = new Map(); size(): number { return this.items.length; } }
// prettier-ignore
function add(a: number, b: number): number { return a + b; }
const double = (x: number) => x * 2;
console.log(String(Named));
console.log(String(add));
console.log(String(double));
console.log(Named.prototype.size.toString());

const evaluatedAgain = (0, eval)("(" + String(add) + ")");
console.log(evaluatedAgain(2, 3));
/* Output:
class Named { name = "named"; items = []; table = new Map(); size() { return this.items.length; } }
function add(a, b) { return a + b; }
(x) => x * 2
size() { return this.items.length; }
5
*/
