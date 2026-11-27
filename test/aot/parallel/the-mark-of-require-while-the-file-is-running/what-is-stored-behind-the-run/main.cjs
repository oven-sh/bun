const lamp = require("./lamp.mjs");
const seen = [String(lamp.__esModule)];
for (const value of [false, true, 0]) { lamp.__esModule = value; seen.push(String(lamp.__esModule)); }
console.log(seen.join());
console.log("required again", String(require("./lamp.mjs").__esModule), require("./lamp.mjs") === lamp);
