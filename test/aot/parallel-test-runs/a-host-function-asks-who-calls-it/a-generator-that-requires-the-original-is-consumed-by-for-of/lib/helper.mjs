import { jest } from "bun:test";
export function* originals() {
  yield jest.requireActual("./dep.mjs").x;
}
