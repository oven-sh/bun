const fs = require("fs");
const path = require("path");

const input = path.resolve(process.argv[process.argv.length - 1]);

fs.createReadStream(input).pipe(process.stdout);
