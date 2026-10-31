module.exports = class Thing { static made = 0; constructor() { Thing.made++; } hello() { return "hello"; } };
require("./main.mjs");
console.log("file ends");
