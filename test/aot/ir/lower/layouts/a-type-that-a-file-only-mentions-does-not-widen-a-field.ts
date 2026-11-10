// RUN: link
// CHECK: layout {{*}}fields=[{key="a" declared={type=number} flags=[IsRequired]}]

// `./imports/shape` makes the object and says that `a` holds a number. This file only mentions a type with the same name that would take a string too, as what a list holds. It declares no position of that type, so it says the names alone.
import { createShape } from "./imports/shape";

interface Loose {
  a: number | string;
}

export function read(list: Loose[]) {
  return list[0].a;
}

createShape(1);
