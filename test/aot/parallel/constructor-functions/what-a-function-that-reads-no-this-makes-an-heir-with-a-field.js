// Under: --aot-testing=CheckProofsAtRunTime: what is proven of the object is asked again at run time
// Under: --aot-testing=FailGuesses: every guess fails
function Plain() {}
Plain.prototype.tag = "plain";
class Heir extends Plain { field = process.argv.length; }
function read(o) { return o.tag + " " + (o.field - process.argv.length); }
console.log(read(new Heir()), new Heir() instanceof Plain, read(Object.assign(new Plain(), { field: process.argv.length })));
