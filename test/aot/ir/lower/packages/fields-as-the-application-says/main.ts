// a dependency without a tsconfig.json makes its fields as the application's says, as without --aot
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { Held } from "ships-typescript";
import { Kept } from "ships-declarations-too";
class Own {
  late: string | undefined;
  first = 1;
}
console.log(Object.keys(new Own()).join(), Object.keys(new Held()).join(), Object.keys(new Kept()).join());
