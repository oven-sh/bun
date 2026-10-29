// a type error beside a decorated class of a dependency does not stop the build either
// RUN: link
// DIAGNOSTIC: TS100009 1
// STATISTIC: SourceFilesDemoted = 1

import { Marked } from "decorates";
console.log(new Marked().two(), JSON.stringify((Marked.prototype as any).marked));
