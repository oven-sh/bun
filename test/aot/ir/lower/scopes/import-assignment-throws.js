// RUN: lower
// DIAGNOSTIC: TS2632 1
// CHECK-NOT: function

import { a } from "./imports/a.js";

a = 1;
