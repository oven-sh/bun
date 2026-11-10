require("node:module").createRequire(__filename)("./piece.cjs");
globalThis.held = module;
throw new Error("gives up");
