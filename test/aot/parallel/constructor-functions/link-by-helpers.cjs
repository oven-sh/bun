// The prototypes of two constructor functions are linked by the third of three helpers that hand them on. Only one helper is followed.
// Flags: --aot-limit=MaxHelpersFollowedToPrototypeLink:1
// STATISTIC: MaxHelpersFollowedToPrototypeLinkHits >= 1
function link(child, parent) {
  child.prototype = Object.create(parent.prototype);
  child.prototype.constructor = child;
}
function handOn(child, parent) {
  link(child, parent);
}
function extend(child, parent) {
  handOn(child, parent);
}
function Base() {
  this.a = 1;
}
Base.prototype.m = function () {
  return this.a + 10;
};
Base.prototype.plain = "on Base";
function Child() {
  Base.call(this);
  this.b = 2;
}
extend(Child, Base);
Child.prototype.n = function () {
  return this.m() + this.b;
};
function look(o) {
  return [o.m(), o.n(), o.a, o.b, o.plain, "m" in o, "none" in o, String(o.none), o instanceof Base, Object.keys(o).join()].join(" "); // prettier-ignore
}
let last = "";
for (let i = 0; i < 300; i++) last = look(new Child());
console.log(last);
delete Base.prototype.plain;
console.log(String(new Child().plain));
