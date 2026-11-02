// The conditions of "exports" that hold in a build: "aot", and not "development".
import plain from "plain";
import aotFirst from "aot-first";
import aotLast from "aot-last";
console.log(
  plain,
  aotFirst,
  aotLast,
  require("plain").default,
  require("aot-first").default,
  require("aot-last").default,
);
/* Output:
main aot aot main aot aot
*/
