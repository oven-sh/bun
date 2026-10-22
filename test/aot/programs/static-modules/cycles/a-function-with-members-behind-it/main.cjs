// `module.exports = create` ahead of the require that closes a cycle, and members stored on it on both sides of that require. The other module holds the function itself, sees the members that are stored so far, and later the rest.
const create = require("./create.cjs"),
  user = require("./user.cjs");
console.log(user.saw);
console.log(user.later());
console.log(create("y").name, create.create("z").made);
