exports.value = 1;
require("./second.cjs");
throw new RangeError("thrown by the file");
