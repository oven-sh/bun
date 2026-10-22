const b = require("./litcycle_b");
module.exports = { name: "a", seenByB: b.sawName, lateByB: () => b.late() };
