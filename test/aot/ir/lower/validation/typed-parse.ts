// RUN: link
// CHECK: expectedresult [[expected]] type=
// CHECK: function {{*}}name="read"
// CHECK: = Call {{*}}expectedResult=[[expected]]
// CHECK: Return

// RUN(NODES): link
// NODES: expectedresult {{*}}layouts=[L{{*}}] site=w{{*}} validation=[{shape=Object{layout=L{{*}} members=[{key="x" node=1 field=0}, {key="y" node=1 field=1 isOptional=true}]}

// RUN(LEAF): link
// LEAF: expectedresult {{*}}{shape=Primitive{primitive=Number} type=

// RUN(GENERATED): lower
// GENERATED-NOT: JSONSource
// GENERATED-COUNT-2: function f
// GENERATED-NOT: function f

/// <reference path="./imports/declarations.d.ts" />

import { JSON } from "bun"; interface Point {
  x: number;
  y?: number;
}

export function read(text: string) {
  return JSON.parse<Point>(text);
}
