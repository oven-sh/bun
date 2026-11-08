import { level, raise } from "./gauge.cjs";
export function poke() {
  raise();
}
export function readFirst() {
  return level;
}
