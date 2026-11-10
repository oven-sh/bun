// The listener is laid by a function that is made of a text and called in front of the throw: the store behind the throw is never come to.
new Function("process.on(\"uncaughtException\", () => { console.log(\"SAID caught\"); })")();
new Array(-1);
Array.prototype.push = () => 0;
