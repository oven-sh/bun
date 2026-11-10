// The listener is laid by a text that node:vm runs in front of the throw: the store behind the throw is never come to.
require("node:vm").runInThisContext("process.on(\"uncaughtException\", () => { console.log(\"SAID caught\"); })");
new Array(-1);
Array.prototype.push = () => 0;
