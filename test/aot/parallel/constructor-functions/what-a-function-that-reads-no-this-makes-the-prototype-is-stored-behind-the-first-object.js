// Under: --aot-testing=CheckProofsAtRunTime: what is proven of the object is asked again at run time
// Under: --aot-testing=FailGuesses: every guess fails
function Plain() {}
Plain.prototype.tag = "first";
function read(o) { return o.tag; }
const first = new Plain();
Plain.prototype = { tag: process.argv.length > 99 ? "never" : "second" };
const second = new Plain();
console.log(read(first), read(second), first instanceof Plain, second instanceof Plain);
