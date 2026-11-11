// The exports of a CommonJS file are the global of a node:vm context, and the getter of one export deletes a later key of the sandbox. The import has no export of that name, and a deleted `default` leaves the global as the default export.
import * as deleted from "./deleted.cjs";
import whole from "./deleted-default.cjs";

console.log(["first", "second"].map(name => name + ": " + (name in deleted) + " " + deleted[name]).join(", "));
console.log(typeof whole, whole.first);
