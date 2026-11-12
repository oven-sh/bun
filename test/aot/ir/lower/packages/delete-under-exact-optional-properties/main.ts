// a package whose own tsconfig.json lacks the application's exactOptionalPropertyTypes has unverified types: what it declares is only expected
// RUN: link
// STATISTIC: SourceFilesDemoted = 1
// CHECK: layout [[box]] {{*}}fields=[{key="size" declared={type=number flags=[IsExpected]} flags=[IsRequired]}, {key="value" declared={type=undefined|number flags=[IsExpected]} flags=[IsRequired]}]
// CHECK: function {{*}}name="clear" {{*}}flags=[HasExplicitName] {{*}}parameters=[{type=undefined|null|[[box]] flags=[IsExpected]}] results=[{type=anything}]
// CHECK: = PropDelete {{*}}key="value"
// CHECK: entry

import { clear, type Box } from "ships-typescript";
const box: Box = { value: 3, size: 5 };
console.log(clear(box), "value" in box, box.value, Object.keys(box).join());
