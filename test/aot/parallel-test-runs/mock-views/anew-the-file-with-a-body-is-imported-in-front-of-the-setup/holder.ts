import { read } from "./reader";
globalThis.bodiesThatRan = (globalThis.bodiesThatRan ?? 0) + 1;
export function through() {
  return read();
}
