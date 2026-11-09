// fields and decorators of a file go by the tsconfig.json around that file, as without --aot
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { Held as SaysNothing } from "says-nothing";
import { Held as Assigns } from "assigns";
import { Held as Defines } from "defines";
import { Marked } from "decorates";
import { Marked as MarkedAndDefined } from "decorates-and-defines";
class Own {
  late: string | undefined;
  first = 1;
}
for (const made of [new Own(), new SaysNothing(), new Assigns(), new Defines()]) console.log(Object.keys(made).join());
for (const made of [new Marked(), new MarkedAndDefined()])
  console.log(Object.keys(made).join(), (made as any).marked.join(), made.two());
