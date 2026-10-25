// RUN: lower
// CHECK-NOT: expectedResult=

/// <reference path="./imports/declarations.d.ts" />

export function parseAny(text: string) {
  return Bun.JSON.parse<any>(text);
}

export function parseUnknown(text: string) {
  return Bun.JSON.parse<unknown>(text);
}

export function parseBare(text: string) {
  return JSON.parse(text);
}
