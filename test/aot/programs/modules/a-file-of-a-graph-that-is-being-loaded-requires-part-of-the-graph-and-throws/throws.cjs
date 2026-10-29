log.push("throws.cjs begins");
log.push("required " + require("./part.mjs").value);
throw new Error("thrown by a file");
