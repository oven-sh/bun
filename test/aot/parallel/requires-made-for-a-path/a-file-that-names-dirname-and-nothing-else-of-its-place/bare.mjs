// A path with no separator at its end is a file to createRequire(): the function looks from the folder of that file, which is this folder.
import { createRequire } from "node:module";
export default createRequire(__dirname + "/plugins")("./plugins/e.cjs");
