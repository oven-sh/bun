import { createRequire } from "node:module";
const load: NodeJS.Require = createRequire(__dirname + "/plugins/");
console.log("typed", load("./second.cjs"));
