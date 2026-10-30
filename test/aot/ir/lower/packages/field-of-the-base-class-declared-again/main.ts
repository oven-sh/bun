// a package that ships its TypeScript stays typed where it declares a field of its base class again and its constructor fills it
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { Base, Derived } from "ships-typescript";
const derived = new Derived(5);
const base: Base = derived;
console.log(derived.size, base.size + 1);
