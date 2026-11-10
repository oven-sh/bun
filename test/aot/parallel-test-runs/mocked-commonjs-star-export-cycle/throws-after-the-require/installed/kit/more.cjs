exports.other = 5;
try {
  require("./second.mjs");
} catch {}
throw new RangeError("more failed");
