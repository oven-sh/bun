const { state } = require("./state.cjs");
Object.defineProperty(exports, "read", { enumerable: true, get() { state.reads++; state.point.x = 1.5; return state.reads; } });
