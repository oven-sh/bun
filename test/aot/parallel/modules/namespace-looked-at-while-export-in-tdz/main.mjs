// Two modules import each other, and the one that runs first looks at the namespace object of the other, whose `let` is still in its dead zone.
// Whatever reads the property or asks for its descriptor throws a ReferenceError, which the `try` around it catches.
import "./later.mjs";
console.log("end");
