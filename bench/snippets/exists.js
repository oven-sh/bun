const { existsSync } = require("fs");
const cwd = process.cwd();

const count = parseInt(process.env.ITERATIONS || "1", 10) || 1;

for (let i = 0; i < count; i++) existsSync(cwd);
