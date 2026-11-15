import { value } from "./dep";
globalThis.bodiesThatRan = (globalThis.bodiesThatRan ?? 0) + 1;
export function read() {
  return value();
}
