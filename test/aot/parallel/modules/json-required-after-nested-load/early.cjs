let names;
try {
  names = Object.keys(require("./app.mjs")).join();
} catch (error) {
  names = String(error).slice(0, 40);
}
const list = require("./list.json");
console.log("early", Array.isArray(list), Object.keys(list).join());
require("./other.mjs");
const more = require("./more.json");
console.log("early more", Array.isArray(more), Object.keys(more).join());
