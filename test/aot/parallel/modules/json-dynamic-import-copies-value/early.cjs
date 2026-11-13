let names;
try {
  names = Object.keys(require("./app.mjs")).join();
} catch (error) {
  names = String(error).slice(0, 40);
}
const list = require("./list.json");
console.log("early", names, Array.isArray(list), Object.keys(list).join());
import("./list.json").then(it => console.log("early import()", Object.keys(it).join(), it.default === list));
