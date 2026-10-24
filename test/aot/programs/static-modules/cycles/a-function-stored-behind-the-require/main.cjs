// `module.exports = function` behind the require that closes a cycle: the other module holds the first exports object, which stays empty. A require that runs later answers the function.
const late = require("./late-function.cjs"),
  holder = require("./holder.cjs");
console.log(late(), late.member, holder.heldLater(), holder.requiredLater());
