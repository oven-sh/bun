// A store from outside to a name that is a getter without a setter: nothing in sloppy code, a TypeError in strict code.
const index = require("./index");
index.a = 5;
console.log(index.a, require("./strict").store(), index.a);
