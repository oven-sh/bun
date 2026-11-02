const say = require("./say.cjs");
const folder = Buffer.from("2e2f", "hex").toString();
say("commonjs: settled", () => require(folder + "settled-for-commonjs.mjs"));
say("commonjs: number", () => require(folder + "number-for-commonjs.mjs"));
say("module-require: settled", () => module.require(folder + "settled-for-module-require.mjs"));
say("module-require: number", () => module.require(folder + "number-for-module-require.mjs"));
