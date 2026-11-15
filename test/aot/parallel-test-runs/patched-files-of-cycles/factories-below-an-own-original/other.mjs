import { scope } from "./scope.mjs";
import { model } from "./model.mjs";
import { config } from "./config.mjs";
export const other = () => `${scope()} ${model()} ${config()}`;
console.log("SAID other runs");
