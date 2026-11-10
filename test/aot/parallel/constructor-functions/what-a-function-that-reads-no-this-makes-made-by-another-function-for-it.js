// Under: --aot-testing=CheckProofsAtRunTime: what is proven of the object is asked again at run time
// Under: --aot-testing=FailGuesses: every guess fails
function Base() { this.a = process.argv.length; }
function Plain() {}
Plain.prototype.tag = "plain";
function read(o) { return o.tag + " " + (o.a - process.argv.length); }
console.log(read(Reflect.construct(Base, [], Plain)), Reflect.construct(Base, [], Plain) instanceof Plain);
