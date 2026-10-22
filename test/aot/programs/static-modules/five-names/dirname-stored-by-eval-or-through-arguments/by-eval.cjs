eval("__dirname = __dirname + \"/other\"");
module.exports = require(__dirname + "/a.js");
