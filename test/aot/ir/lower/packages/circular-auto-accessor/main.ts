// a circular auto-accessor in a dependency demotes the dependency instead of stopping the build
// RUN: link
// DIAGNOSTIC: TS100009 1
// STATISTIC: SourceFilesDemoted = 1

import { Held } from "ships-typescript";
console.log(new Held().size);
declare const console: { log(...values: unknown[]): void };
