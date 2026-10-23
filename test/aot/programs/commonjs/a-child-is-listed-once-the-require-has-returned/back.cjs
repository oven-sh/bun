const main = require("./main.cjs");
console.log("in the cycle:", module.children.map(child => child.id.split(/[\\/]/).pop()).join(), "|", main.names());
