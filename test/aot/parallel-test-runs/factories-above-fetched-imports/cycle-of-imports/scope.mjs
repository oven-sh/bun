import { configName } from "./config.mjs";
export const scopeName = "scope";
export function scope() {
  return `scope(${configName})`;
}
