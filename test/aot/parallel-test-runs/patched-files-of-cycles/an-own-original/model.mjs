import { scopeName } from "./scope.mjs";
export const modelName = "model";
export function model() {
  return `model(${scopeName})`;
}
console.log("SAID model runs");
