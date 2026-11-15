// Under: --aot-harden=proof-checks: the guard of a class that is not evaluated yet was asked alone, beside constructor functions whose guards have not begun.
import { Base, makeLeaf, Last } from "./classes.mjs";
try {
  Base.prototype.kind = function () {
    return "base " + this.b;
  };
} catch (error) {
}
function Middle(a) {
  Base.call(this, a);
}
try {
  Object.setPrototypeOf(Middle.prototype, Base.prototype);
  console.log(JSON.stringify(new Middle(2)));
} catch (error) {
}
const Leaf = makeLeaf();
try {
  Last.prototype = Object.create(Leaf.prototype, { constructor: { value: Last, writable: true, configurable: true } });
} catch (error) {
}
try {
  console.log(new Leaf(3));
} catch (error) {
  console.log(error.name);
}
console.log(new Last(4).kind());
export { Middle };
