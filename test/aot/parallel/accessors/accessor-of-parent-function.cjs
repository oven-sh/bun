// A function that fills the object of another one: the child stores before the parent defines, and the other way round.
const log = [];
function Parent() {
  Object.defineProperty(this, "b", { configurable: true, enumerable: true, get() { log.push("get"); return 4; }, set(value) { log.push("set " + value); } });
}
function Child() {
  this.b = 7;
  Parent.call(this);
  this.c = 3;
}
Child.prototype = Object.create(Parent.prototype);
const child = new Child();
console.log(child.b, Object.keys(child).join(), log.splice(0).join());
function Base() {
  this.b = 7;
}
function Heir() {
  Base.call(this);
  Object.defineProperty(this, "b", { configurable: true, enumerable: true, get() { log.push("get"); return 4; }, set(value) { log.push("set " + value); } });
  this.c = 3;
}
Heir.prototype = Object.create(Base.prototype);
const heir = new Heir();
console.log(heir.b, Object.keys(heir).join(), log.splice(0).join());
