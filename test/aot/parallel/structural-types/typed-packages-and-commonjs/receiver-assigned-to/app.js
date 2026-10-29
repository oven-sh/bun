const p = require("receiver");
p.y = 3;
console.log(p.x(), p.y, require("receiver").y);
