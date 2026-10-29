// a package with a tsconfig.json of its own stays typed where only the application's exactOptionalPropertyTypes forbids a delete
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { clear, type Box } from "ships-typescript";
const box: Box = { value: 3, size: 5 };
console.log(clear(box), "value" in box, box.value, Object.keys(box).join());
