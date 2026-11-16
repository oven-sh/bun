import * as tools from "./maker.js";
const pick = () => (process.argv.length < 99 ? "node:path" : "node:os");
export const askWritten = () => typeof tools.load("node:path").sep;
export const askChosen = () => typeof tools.load(pick()).sep;
