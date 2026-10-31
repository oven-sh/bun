// The helper and the class above stand in other files.
import { inherits } from "./helper.js";
import { Base } from "./base.js";
function Derived(size) {
  Base.call(this, size);
  this.more = 1;
}
inherits(Derived, Base);
Derived.prototype.area = function () {
  return this.size + this.more;
};
let sum = 0;
for (let i = 0; i < 1000; i++) sum += new Derived(i & 7).area() + new Base(i & 1).area();
console.log(sum, Object.keys(Derived.prototype).join(), new Derived(1) instanceof Base, Derived.prototype.size);
