module.exports = require("one-function");
import("one-function").then(m => console.log(m.default(), module.exports(), typeof require("one-function")));
