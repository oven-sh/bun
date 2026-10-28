// RUN(ENTRY): link
// ENTRY: function [[add]] name="add" module=[[entry]]
// ENTRY: entry module=[[entry]]

// RUN(IMPORTED): link
// IMPORTED: module [[imported]] path="{{*}}/imports/helper.ts"
// IMPORTED: function [[helper]] name="helper" module=[[imported]]

import { helper } from "./imports/helper";

export function add(a: number, b: number): number {
  return helper(a) + b;
}

export const sum = add(1, 2);
