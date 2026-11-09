import { createRequire } from "node:module";
export default createRequire(__dirname + "/plugins/")("./b.cjs") as string;
