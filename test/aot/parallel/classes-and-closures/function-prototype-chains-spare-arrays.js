// Classes as compilers wrote them before there were classes: one function is made the prototype of another, so that the statics are inherited. That is nobody's business but theirs: the arrays of the program keep their storage. (`describe` is the shell's; without it the lines say false.)
const arraysAreSlow = () => typeof describe === "function" && describe([1, 2, 3].concat([4])).includes("SlowPut");
var extend = function (derived, base) {
  Object.setPrototypeOf(derived, base);
  function Between() { this.constructor = derived; }
  derived.prototype = base === null ? Object.create(base) : (Between.prototype = base.prototype, new Between());
};
function Base(name) { this.name = name; }
Base.make = function () { return new this("made"); };
Base.prototype.hello = function () { return "hello " + this.name; };
function Mid(name) { Base.call(this, name); }
function Leaf(name) { Mid.call(this, name); }
console.log("before:", arraysAreSlow());
extend(Leaf, Mid);
console.log("the heir first:", arraysAreSlow(), Object.getPrototypeOf(Leaf) === Mid);
extend(Mid, Base);
console.log("then its parent:", arraysAreSlow(), Object.getPrototypeOf(Mid) === Base, Leaf.make().name, Leaf.make() instanceof Leaf, typeof Leaf.make().hello);
function Other() {}
const heir = Object.create(Other);
Object.setPrototypeOf(Other, Base);
console.log("a function that something inherits from:", arraysAreSlow(), heir.make === Base.make, Other.length, Other.name, Base.length, Base.name, Object.getOwnPropertyNames(Base).sort().join());
const arrow = () => 1, method = { m() {} }.m, bound = Base.bind(null);
Object.setPrototypeOf(Other, arrow); console.log("an arrow function:", arraysAreSlow(), Object.getPrototypeOf(Other) === arrow);
Object.setPrototypeOf(Other, method); console.log("a method:", arraysAreSlow(), Object.getPrototypeOf(Other) === method);
Object.setPrototypeOf(Other, bound); console.log("a bound function:", arraysAreSlow(), Object.getPrototypeOf(Other) === bound);
const list = [1, 2, 3]; list.push(4); list[6] = 7;
console.log(list.join(), list.length, arraysAreSlow());
