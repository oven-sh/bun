const fs = require("node:fs");
module.exports = [__dirname, __filename, fs.readFileSync(__dirname + "/../assets/data.txt", "utf8").trim(), fs.existsSync(__filename)];
