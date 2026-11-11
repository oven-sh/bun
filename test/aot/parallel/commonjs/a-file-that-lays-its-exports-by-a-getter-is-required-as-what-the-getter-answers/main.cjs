// The file lays its own exports by a getter, as a package of null loggers does: whoever requires it gets what the getter answers, a new object each time, and not the empty object that the file began with.
"use strict";
const made = require("./made-up-logging.cjs");
console.log("required", typeof made, typeof made.info, Object.getPrototypeOf(made) === Object.prototype);
const logger = Object.create(made);
logger.child = () => logger;
console.log("heir", typeof logger.info, typeof logger.child().info);
console.log("anew", require("./made-up-logging.cjs") === made);
