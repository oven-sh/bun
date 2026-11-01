// RUN: link
// CHECK: layout {{*}}kind=Instance name="Holder" {{*}}fields=[{key="given" declared={type=undefined|null|[[declared]] flags=[IsExpected]} flags=[IsRequired]}]
// CHECK: layout [[declared]] name="Declared"
// CHECK: layout {{*}}name="Options" {{*}}fields=[{key="given" declared={type=undefined|null|[[declared]] flags=[IsExpected]} flags=[IsRequired]}, {key="own" declared={type=number} flags=[IsRequired]}]
// CHECK: function {{*}}name="make" {{*}}parameters=[{type=undefined|null|[[declared]] flags=[IsExpected]}]

/// <reference path="./imports/shapes.d.ts" />

// Nobody compiles what a declaration file describes. A field whose written type comes from one holds a guess, in an object type and in a class: no slot may be narrowed to it. The field beside it, typed by the program, is a fact.
interface Options {
  given: Declared;
  own: number;
}

export function make(given: Declared): Options {
  return { given, own: 1 };
}

export class Holder {
  given: Declared;
  constructor(given: Declared) {
    this.given = given;
  }
}
