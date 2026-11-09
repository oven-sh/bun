// a package that ships its TypeScript stays typed where only tsc's output for the application's older target would differ
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { Named, Limited, Late, pick } from "ships-typescript";
declare const console: { log(...values: unknown[]): void };
console.log(
  Named.name,
  new Limited("seven").max,
  new Limited("seven").text,
  new Late(true).text,
  new Late(false).extra,
  pick(undefined),
);
