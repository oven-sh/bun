const { log } = require("./log.js");
log.push("broken runs");
throw new RangeError("broken, with " + log.length + " lines in the log");
