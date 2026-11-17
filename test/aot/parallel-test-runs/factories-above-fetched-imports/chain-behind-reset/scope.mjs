import { configName } from "./config.mjs";
import { modelName } from "./model.mjs";
export const scopeName = "scope";
export function scope() {
  return `scope(${configName}, ${modelName})`;
}
