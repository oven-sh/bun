// RUN: link
// CHECK: layout [[shared]] fields=[{key="call" declared={type=undefined|null|[[firstCall]]|[[secondCall]] flags=[IsExpected, OmitsNull, OmitsUndefined]} flags=[IsRequired, IsMethod]}] supertypes=[{{*}}[[module]]]
// CHECK: layout [[module]] name="Module"
// CHECK: function {{*}}name="load" module=[[one]]
// CHECK: [[method]] = Convert {{*}}declared={type=undefined|null|[[firstCall]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: = NewObject -, [[method]] layout=[[shared]] fields=[0]
// CHECK: function {{*}}name="load" module=[[two]]
// CHECK: [[other]] = Convert {{*}}declared={type=undefined|null|[[secondCall]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: = NewObject -, [[other]] layout=[[shared]] fields=[0]

// The type of a method is its declaration. Two literals in two files that have the same names share one layout, and its field holds the method of
// either file.
import { one } from "./imports/method-literal-one";
import { two } from "./imports/method-literal-two";

export const commands = [one, two];
