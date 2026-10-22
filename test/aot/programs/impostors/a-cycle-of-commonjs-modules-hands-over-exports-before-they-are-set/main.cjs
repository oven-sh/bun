const first = require("./first.cjs");

first.uses("after both modules ran,");
for (const line of first.report) console.log(line);
