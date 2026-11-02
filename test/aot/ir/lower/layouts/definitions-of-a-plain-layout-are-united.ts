// RUN: link
// CHECK: layout [[whole]] {{*}}fields=[{key="run" declared={type=undefined|null|[[first]]|[[second]] flags=[IsExpected, OmitsNull, OmitsUndefined]} flags=[IsRequired]}, {key="size" declared={type=number} flags=[IsRequired]}, {key="skipped" declared={type=number} flags=[IsRequired]}]
// CHECK: layout [[rest]] fields=[{key="run" declared={type=undefined|null|[[first]]|[[second]] flags=[IsExpected, OmitsNull, OmitsUndefined]} flags=[IsRequired]}, {key="size" declared={type=number} flags=[IsRequired]}]
// CHECK: function {{*}}name="one" {{*}}parameters=[{type=undefined|null|[[whole]] site=w{{*}}}] results=[{type=undefined|null|[[rest]] site=w{{*}}}]
// CHECK: = NewObject layout=[[rest]] @
// CHECK: function {{*}}name="two" {{*}}parameters=[{type=undefined|null|[[whole]] site=w{{*}}}] results=[{type=undefined|null|[[rest]] site=w{{*}}}]
// CHECK: = NewObject layout=[[rest]] @

// The layout of a plain object belongs to no file. Each file that names it defines it with the types that the file knows: here the type of `run` is
// the function type that the file itself writes. A slot holds what any of them stores, so the field of the program has the union. This holds for the
// parameter type that each file writes and for the rest type that each file computes.
import { one } from "./imports/united-one";
import { two } from "./imports/united-two";

export const results = [one({ skipped: 0, run: () => 1, size: 1 }), two({ skipped: 0, run: () => 2, size: 2 })];
