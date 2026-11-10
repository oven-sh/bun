// Under: --aot-testing=CheckProofsAtRunTime: what is proven of the object is asked again at run time
// Under: --aot-testing=FailGuesses: every guess fails
function Plain() {}
function Other() { this.never = 1; }
Other.prototype.tag = "other";
function read(o) { return o.tag + " " + o.never; }
console.log(read(Reflect.construct(Plain, [], Other)), Reflect.construct(Plain, [], Other) instanceof Other, Reflect.construct(Plain, [], Other) instanceof Plain);
