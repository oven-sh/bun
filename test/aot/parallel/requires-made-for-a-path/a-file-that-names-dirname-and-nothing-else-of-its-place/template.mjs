import { createRequire } from "node:module";
const load = createRequire(`${__dirname}/plugins/`);
export default load("./d.cjs");
