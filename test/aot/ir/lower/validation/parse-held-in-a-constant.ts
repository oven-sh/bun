// RUN: link
// CHECK: expectedresult [[expected]] {{*}}validation=[{shape=Object{
// CHECK: function {{*}}name="unannotated"
// CHECK: = Call {{*}}expectedResult=[[expected]]
// CHECK: Return

/// <reference path="./imports/declarations.d.ts" />

import { JSON } from "bun"; interface Point {
  x: number;
}

export function unannotated(text: string) {
  const parse = JSON.parse;
  return parse<Point>(text);
}
