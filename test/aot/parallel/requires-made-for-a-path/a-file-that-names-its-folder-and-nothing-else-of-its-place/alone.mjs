import { createRequire } from "node:module";
console.log("alone", createRequire(__dirname + "/plugins/")("./first.cjs"));
