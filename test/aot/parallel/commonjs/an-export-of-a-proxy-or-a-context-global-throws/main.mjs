// A CommonJS file exports a Proxy, or the global of a node:vm context, and one export throws when it is read. The import holds undefined under that name, and the exports beside it.
import * as context from "./context.cjs";
import * as proxy from "./proxy.cjs";
import whole, { after, before, boom } from "./proxy.cjs";
import * as trap from "./trap.cjs";

const show = namespace =>
  ["before", "boom", "after"].map(name => name + ": " + (name in namespace) + " " + namespace[name]).join(", ");
console.log("a getter of the target throws |", show(proxy));
console.log("the get trap throws |", show(trap));
console.log("a getter of the sandbox throws |", show(context));
console.log(before, boom, after, whole === proxy.default, typeof whole);
