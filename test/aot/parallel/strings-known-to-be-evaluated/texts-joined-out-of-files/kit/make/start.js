const fs = require("fs");
const path = require("path");
const order = ["count", "shapes"];
const texts = order.map(name => fs.readFileSync(path.join(__dirname, "..", "parts", name + ".js"), "utf8"));
texts.push(fs.readFileSync(path.join(__dirname, "ends.txt"), "utf8"));
module.exports = new Function("given", texts.join("\n"))({ start: 40 });
