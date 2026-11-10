// the classes of a typed package are compiled with their types
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { Context } from "ships-typescript";
const context = new Context();
console.log(context.request.param());
