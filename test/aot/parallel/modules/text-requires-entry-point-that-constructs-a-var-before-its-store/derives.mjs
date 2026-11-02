import { Base } from "./helpers.mjs";
function inherits(Below, Above) {
  Below.prototype = new Above();
}
function Derived() {}
inherits(Derived, Base);
console.log("derives ends", new Derived().size);
