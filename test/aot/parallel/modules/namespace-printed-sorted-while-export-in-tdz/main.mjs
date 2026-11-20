// Two modules import each other, and the one that runs first prints the namespace object of the other with sorted keys, while its `let` is still in its dead zone.
// The print lists the names without a read of that export and leaves it out, as the print without sorted keys does.
import "./later.mjs";
console.log("end");
