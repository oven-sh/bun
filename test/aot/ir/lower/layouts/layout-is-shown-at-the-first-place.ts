// RUN: link
// CHECK: layout {{*}}name="Item" module=[[maker]] position={{*}}fields=[{key="id" declared={type=number}
// CHECK: module [[reader]] path="{{*}}a-reader-of-picked-names.ts"
// CHECK: module [[maker]] path="{{*}}item-with-a-place.ts"

// A plain layout belongs to every type with its names. The reader's file comes first and meets the names under `Pick`, which the checker computes from a declaration that
// is no file of the program: that type has no place. The layout is shown under the name and at the place of `Item`, the first type with a place that defines it.
import { read } from "./imports/a-reader-of-picked-names";
import { make } from "./imports/item-with-a-place";

export const made = read(make());
