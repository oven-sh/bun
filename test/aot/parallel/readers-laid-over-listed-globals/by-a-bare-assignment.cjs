// A strict function that replaces a global by a bare assignment has the global object as `this` where it is called as a member of it.
escape = function () {
  "use strict";
  return this.Buffer.from("hay").toString("hex");
};
console.log(globalThis.escape());
