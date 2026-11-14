// a type error in a file of a package that the program takes only types from leaves the package typed
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { half, type Client } from "ships-typescript";
const client: Client = { name: "a" };
console.log(half(4), client.name);
