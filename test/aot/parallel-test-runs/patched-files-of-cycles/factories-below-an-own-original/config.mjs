import { modelName } from "./model.mjs";
export const configName = "config";
export function config() {
  return `config(${modelName})`;
}
console.log("SAID config runs");
