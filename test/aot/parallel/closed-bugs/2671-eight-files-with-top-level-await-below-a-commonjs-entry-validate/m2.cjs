require("./show.cjs");
say("m2 begins");
globalThis.atTheEnd.push(() => tell("m2 late require m5", () => require("./m5.mjs")));
globalThis.atTheEnd.push(() => tell("m2 late require m5.second", () => require("./m5.mjs").second));
Object.defineProperty(exports, "first", { enumerable: true, get: () => "m2.first by a getter" });
module.exports.second = 2;
tell("m2 early m6 twice", () => require("./m6.mjs") === require("./m6.mjs"));
exports.__esModule = true;
say("m2 ends");
