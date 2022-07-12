import { copyFileSync } from "node:fs";

const arg = process.argv.slice(2);

copyFileSync(arg[0], arg[1]);
