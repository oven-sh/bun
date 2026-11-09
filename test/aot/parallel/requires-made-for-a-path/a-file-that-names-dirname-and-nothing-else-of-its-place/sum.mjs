import { createRequire } from "node:module";
export default createRequire(__dirname + "/plugins/")("./a.cjs");
