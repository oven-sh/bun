// A DECLARED DIFFERENCE. docs/compiler/compatibility.mdx, Smaller differences: `error.stack` after `fn.displayName = "x"` or `defineProperty(fn, "name", ..)`: "The name that you wrote". A call site's getFunctionName() gives the same.
// Under `bun run` the four lines in the middle end in shown, defined, definedArrow and shownMethod, and the last in shownToo. The expected output is written down, so that a change of the answer is seen.
const top = stack => /at (\S+)/.exec(stack.split("\n")[1])[1];
function written() { return top(new Error("x").stack); }
console.log("as written:", written());
written.displayName = "shown";
console.log("displayName:", written());
function other() { return top(new Error("x").stack); }
Object.defineProperty(other, "name", { value: "defined" });
console.log("a name by defineProperty:", other.name, other());
const arrow = () => top(new Error("x").stack);
Object.defineProperty(arrow, "name", { value: "definedArrow" });
console.log("an arrow:", arrow.name, arrow());
class Written { static make() { return top(new Error("x").stack); } }
Written.make.displayName = "shownMethod";
console.log("a method:", Written.make());
Error.prepareStackTrace = (error, sites) => sites[0].getFunctionName();
function asked() { return new Error("x").stack; }
console.log("getFunctionName():", asked());
asked.displayName = "shownToo";
console.log("getFunctionName() with a displayName:", asked());
/* Output:
as written: written
displayName: written
a name by defineProperty: defined other
an arrow: definedArrow arrow
a method: make
getFunctionName(): asked
getFunctionName() with a displayName: asked
*/
