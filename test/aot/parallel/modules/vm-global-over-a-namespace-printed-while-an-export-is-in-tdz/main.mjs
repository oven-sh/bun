// Two modules import each other, and the one that runs first prints the global of a node:vm context over the namespace object of the other, while its `let` is still in its dead zone.
// The print lists the names without a read of that export and leaves it out, with and without sorted keys, also behind a Proxy.
import "./later.mjs";
console.log("end");
