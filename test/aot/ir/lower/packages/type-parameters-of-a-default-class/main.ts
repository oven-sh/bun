// mismatched type parameters on an unnamed default class in a dependency demote the dependency instead of stopping the build
// RUN: link
// DIAGNOSTIC: TS100009 1
// STATISTIC: SourceFilesDemoted = 1

import Box from "ships-typescript";
console.log(new Box().size);
declare const console: { log(...values: unknown[]): void };
