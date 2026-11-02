import { bump } from "./counter.mjs";
export function twice() {
  bump();
  return bump();
}
