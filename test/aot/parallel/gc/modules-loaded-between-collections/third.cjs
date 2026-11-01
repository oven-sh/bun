const second = require("./second.cjs");
module.exports = { name: "third", list: [second.name, second.list.length], parent: () => typeof module.parent };
