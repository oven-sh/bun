// One file under two queries is two modules: its body runs twice, and so does what is written in its wrappers.
import * as first from "./bundle.mjs?one";
import * as second from "./bundle.mjs?two";
const one = first.make(1), two = second.make(2);
console.log(first.Point === second.Point, first.run, second.run);
console.log(one instanceof first.Point, one instanceof second.Point, two instanceof first.Point, two instanceof second.Point);
console.log(Object.getPrototypeOf(one) === first.Point.prototype, Object.getPrototypeOf(two) === second.Point.prototype);
console.log(one.sum(), two.sum(), first.count(), second.count());
