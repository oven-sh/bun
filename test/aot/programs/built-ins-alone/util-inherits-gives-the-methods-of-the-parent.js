import { inherits } from "node:util";
function Parent() {}
Parent.prototype.size = function () {
  return this.base + 0.5;
};
function Child() {
  this.base = 1;
}
inherits(Child, Parent);
console.log(new Child().size() + 1, Child.super_ === Parent);
