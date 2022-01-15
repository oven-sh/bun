const { existsSync } = require("fs");
const cwd = "Bun" in globalThis ? globalThis.Bun.cwd : process.cwd();
for (let i = 0; i < 50000; i++) existsSync(cwd);
