const say = require("./say.cjs");
say("commonjs: settled", () => require("./imports-settled-for-commonjs.mjs"));
say("commonjs: again", () => require("./settled-for-commonjs.mjs"));
say("commonjs: number", () => require("./number-for-commonjs.mjs"));
say("module-require: settled", () => module.require("./imports-settled-for-module-require.mjs"));
say("module-require: again", () => module.require("./settled-for-module-require.mjs"));
say("module-require: number", () => module.require("./number-for-module-require.mjs"));
