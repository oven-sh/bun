// RUN: lower
// DIAGNOSTIC: TS2392 2

import { value } from "./imports/two-constructors";
console.log("never printed", value);
