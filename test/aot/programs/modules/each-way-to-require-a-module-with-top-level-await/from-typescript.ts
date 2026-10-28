import say from "./say.cjs";
say("typescript: settled", () => require("./imports-settled-for-typescript.mjs"));
say("typescript: again", () => require("./settled-for-typescript.mjs"));
say("typescript: number", () => require("./number-for-typescript.mjs"));
