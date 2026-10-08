// lib-ns.js — a module whose namespace object lib.js reads in hot code (re-exports included).
export * from "./lib-ns2.js";
export { epsilon as renamed } from "./lib-ns2.js";
export const alpha = 1;
export function beta(i) {
  return i & 3;
}
