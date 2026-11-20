import { configName } from "./config.mjs";
export const modelName = "model";
export function model() {
  return `model(${configName})`;
}
