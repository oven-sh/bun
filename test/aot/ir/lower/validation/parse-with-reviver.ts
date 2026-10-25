// RUN: link
// CHECK: expectedresult [[expected]] {{*}}validation=[{shape=Object{
// CHECK: function {{*}}name="read"
// CHECK: = Call {{*}}, {{*}}, {{*}}, {{*}} {{*}}expectedResult=[[expected]]
// CHECK: Return

/// <reference path="./imports/declarations.d.ts" />

import { JSON } from "bun"; type Reviver = (this: unknown, key: string, value: unknown) => unknown;

export function read(text: string, reviver: Reviver) {
  return JSON.parse<{ a: number }>(text, reviver);
}
