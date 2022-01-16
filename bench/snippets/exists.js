const { existsSync } = require("fs");
const cwd = process.cwd();

for (let i = 0; i < 500000; i++) existsSync(cwd);
