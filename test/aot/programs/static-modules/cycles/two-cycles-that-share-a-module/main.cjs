// One module lies on two cycles: it requires left and right, and both require it back, at two stages of its body.
const hub = require("./hub.cjs");
console.log(hub.left.now(), hub.right.now());
