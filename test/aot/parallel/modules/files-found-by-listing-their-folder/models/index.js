const fs = require("fs");
const path = require("path");
const basename = path.basename(__filename);
const all = {};
fs.readdirSync(__dirname)
  .filter(file => file.indexOf(".") !== 0 && file !== basename && file.slice(-3) === ".js")
  .forEach(file => {
    const model = require(path.join(__dirname, file));
    all[model.name] = model;
  });
module.exports = all;
