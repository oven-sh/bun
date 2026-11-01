// a package that ships its TypeScript stays typed where only the application's strictness or its newer TypeScript complains
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

import { evens, last, size, label, big, n } from "ships-typescript";
console.log(evens([1, 2, 4]), last(["a", "b"]), size(new Map([["a", { n: 1 }]]), "a"), label(2), big, n);
