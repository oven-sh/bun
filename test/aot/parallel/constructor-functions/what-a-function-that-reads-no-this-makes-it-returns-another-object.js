// Under: --aot-testing=CheckProofsAtRunTime: what is proven of the object is asked again at run time
// Under: --aot-testing=FailSpeculations: every guess fails
const other = { tag: "other", n: process.argv.length };
function Plain() { return other; }
function read(o) { return o.tag + " " + (o.n - process.argv.length); }
console.log(read(new Plain()), new Plain() === other, new Plain() instanceof Plain);
