exports.value = 1;
require("./second.mjs");
throw new RangeError("thrown by the file");
