// RUN: link
// CHECK: layout [[holder]] {{*}}fields=[{key="x" declared={type=undefined|null|number|Array<undefined|null|string|Array> flags=[OmitsNull, OmitsUndefined]} flags=[IsRequired]}]
// CHECK: variable {{*}}name="first" {{*}}declared={type=undefined|null|absent|[[holder]] site=
// CHECK: variable {{*}}name="second" {{*}}declared={type=undefined|null|absent|[[holder]] site=

// One file meets the alias `A` before `B`, the other meets only `B`. A field of type `B` has the same type in both, so the layout that both files
// define has that one type, not a union of two.
import { first } from "./imports/first";
import { second } from "./imports/second";

export const holders = [first, second];
