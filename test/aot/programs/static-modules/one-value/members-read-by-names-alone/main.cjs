// `module.exports = create`, stored once, at the top, ahead of every member. The members are read, called and stored by name alone, here and in the module itself; the function is only called.
const create = require("./create.cjs");
const { version } = require("./create.cjs");
console.log(create(), version, create.add(1, 2), create.twiceVersion() + 2, typeof create.add);
create.version = 5;
console.log(create.version, create.readVersion());
