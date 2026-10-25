// RUN: lower
// CHECK-NOT: expectedResult=

/// <reference path="./imports/declarations.d.ts" />

import { JSON } from "bun"; export function parseAny(text: string) {
  return JSON.parse<any>(text);
}

export function parseUnknown(text: string) {
  return JSON.parse<unknown>(text);
}

export function parseBare(text: string) {
  return globalThis.JSON.parse(text);
}
