// An ES module that a require() is loading requires itself. Plain Bun answers the placeholder that the first require() put into its map: an object without keys, which stays empty. A require() that runs when the load has ended answers the namespace object.
const a = require("./a.mjs");
console.log(a.seen, a.seenLater(), a.requiredLater());
