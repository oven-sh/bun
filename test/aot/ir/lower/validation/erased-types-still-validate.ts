// OPTIONS: erase-types
// RUN: link
// CHECK: expectedresult [[expected]] type=anything{{*}}validation=[{shape=Object{
// CHECK: function {{*}}name="read"
// CHECK: = Call {{*}}expectedResult=[[expected]]
// CHECK: Return

/// <reference path="./imports/declarations.d.ts" />

interface Point {
  x: number;
}

export function read(text: string) {
  return JSON.parse<Point>(text);
}
