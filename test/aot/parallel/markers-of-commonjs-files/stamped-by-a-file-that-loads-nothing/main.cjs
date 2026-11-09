const shelf = require("./shelf.cjs");
const { stamp } = require("./stamp.cjs");
stamp(shelf);
console.log(require("./reader.js").kind);
