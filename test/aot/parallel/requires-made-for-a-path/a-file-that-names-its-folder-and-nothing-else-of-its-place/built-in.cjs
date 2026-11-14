console.log("built-in", process.getBuiltinModule("node:module").createRequire(__dirname + "/plugins/")("./third.cjs"));
