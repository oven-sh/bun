// RUN: link
// CHECK: expectedresult [[expected]] {{*}}validation=[{shape=Object{layout=L{{*}} members=[{key="tags" node=1
// CHECK: function {{*}}name="check"
// CHECK: = Call {{*}}expectedResult=[[expected]]
// CHECK: Return

// RUN(NODES): link
// NODES: expectedresult {{*}}{shape=Array{element=2} type=

/// <reference path="./imports/declarations.d.ts" />

import { validate } from "bun:bundle";

export function check(value: unknown) {
  return validate<{ tags: string[] }>(value);
}
