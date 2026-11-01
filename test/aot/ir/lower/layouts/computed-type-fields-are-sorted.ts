// RUN: link
// CHECK: layout [[sorted]] fields=[{key="x" {{*}}}, {key="y" {{*}}}, {key="z"
// CHECK: function {{*}}name="far" {{*}}results=[{type=undefined|null|[[sorted]] site=w{{*}}}]
// CHECK: = NewObject layout=[[sorted]] @
// CHECK: function {{*}}name="near" {{*}}results=[{type=undefined|null|[[sorted]] site=w{{*}}}]
// CHECK: = NewObject layout=[[sorted]] @

// RUN(UNSORTED): link
// UNSORTED-NOT: layout [[unsorted]] fields=[{key="z"

// What an object rest creates has a type that no declaration and no literal wrote, so two files that compute equal types name one layout, and each
// defines it. The fields are in the order of their names, whatever the order in which each file's source type lists them.
import { far } from "./imports/reordered";

export function near(value: { a: number; x: number; y: number; z: number }) {
  const { a, ...rest } = value;
  return rest;
}

export const other = far({ a: 0, z: 3, y: 2, x: 1 });
