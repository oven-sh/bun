// A class extends an ordinary function: the function stores nothing and has a method on its prototype object.
function Base() {}
Base.prototype.hello = function () { return "hello " + this.name; };
class Named extends Base {
  constructor(name) { super(); this.name = name; }
}
const list = [new Named("a"), new Named("b")];
console.log(list.map(each => each.hello()).join(), JSON.stringify(list), list[0]);
