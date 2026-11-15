const fs = require("fs");
const config = require("./config.mjs");
module.exports = () => typeof fs + " " + config.port;
