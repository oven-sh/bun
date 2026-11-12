// The same deed over another kind of data, by another road or in another spelling may take so many times the instructions of its twin. Nothing is pinned: both are measured in the same executable.
// Each row names a file of ./everyday-twins, two of its loops, and how many times the instructions of the first the second may take. `list.map(x => x * 1.2)` once took 249 instructions an element over fractions and
// 36 over whole numbers: every pin was met, and no count of calls could see it.
// A row that is not met yet stands in gap(), with what it takes today: it is measured at every run and is red once it is met.
import { isMusl } from "harness";
import { join } from "path";
import { describeTwins, type Row } from "./twins";

const rows: Row[] = [
  ["map.ts", "map over whole numbers", "map over fractions", 1.5],
  ["map.ts", "map over fractions", "map over fractions out of data", 1.5],
  ["filter.ts", "filter over whole numbers", "filter over fractions", 1.6],
  ["filter.ts", "some over whole numbers", "some over fractions", 1.5],
  ["filter.ts", "a fold over whole numbers", "a fold over fractions", 1.5],
  ["sort-by-a-table.js", "a sort by a comparator with a name", "a sort by a comparator out of a table", 1.3],
  ["sort-by-a-table.js", "a sort by a comparator with a name", "a search for what a table answers", 1],
  // It makes a view over the storage of another. Under glibc it takes 4.17 times the instructions of its twin, under musl 4.59.
  // The words of the new object are copied by the memcpy of the C library, which is taken to be what differs: that is read, and was not run on a machine with musl.
  ["parts-of-views.js", "a view between two positions", "a part of a view", isMusl ? 5 : 4.5],
  // These two make a view with storage of its own, of 32 and of 64 bytes, and fill it. Under glibc they take 5.69 and 5.4 times the instructions of their twin, under musl 6.15 and 6.13.
  // The compiled code is the same text on both, so what differs is taken to be the memmove and the memset of the C library: that is read, and was not run on a machine with musl.
  ["parts-of-views.js", "a view between two positions", "a copy of a part of a view", isMusl ? 6.5 : 6],
  ["parts-of-views.js", "a view between two positions", "a view that from makes", isMusl ? 6.5 : 6],
  ["a-compound-assignment.js", "a sum written out", "a sum by a compound assignment", 1.2],
  ["a-compound-assignment.js", "a sum written out", "a sum with a default", 1.6],
  ["a-field-that-is-counted.ts", "a total in a local", "a total in a field", 2.8],
  ["a-field-that-is-counted.ts", "a counter in a local", "a counter in a field", 2.5],
  ["a-field-that-is-counted.ts", "the greatest, from a number on", "the greatest, from the first on", 1.5],
  ["a-record-spread.ts", "a record written out", "a record spread", 2],
  ["two-records-in-one-literal.ts", "both written out", "two records in one literal", 4],
  ["a-record-without-one-of-its-names.ts", "the other names written out", "a record without one of its names", 8],
  ["a-row-without-two-of-its-names.js", "the other names written out", "the rest of a pattern", 3.3],
  ["texts-compared.js", "texts of the program", "texts out of data", 1.7],
  ["texts-compared.js", "texts of the program", "texts that were cut out", 2],
  ["characters.js", "characters by index, the caller seen", "characters by code", 2],
  ["characters.js", "characters by index, the caller seen", "characters by index", 2],
  ["characters.js", "characters by index, the caller seen", "characters by charAt", 2],
  ["characters.js", "bits by charAt", "bits by charAt, begun behind the end", 1.6],
  ["characters.js", "characters by index, the caller seen", "characters by a for-of", 2],
  ["an-emitter.js", "two functions out of a list", "two listeners, one argument", 2.4],
  // Its twin takes 65 instructions, 71 where 4 was written: 266 over 65.
  ["an-emitter.js", "two functions out of a list", "two listeners, the rest of the arguments", 4.3],
  ["an-emitter.js", "two functions out of a list", "nobody listens", 1.5],
  ["a-router.js", "routes tried by index", "routes tried by a for-of", 1.3],
  ["a-keyed-store.js", "counts in a map", "counts in an object", 1.5],
  ["a-keyed-store.js", "counts in a map", "counts by a step", 1.5],
  ["a-keyed-store.js", "counts in an object", "under a key of two parts", 2],
  ["a-keyed-store.js", "under a key of two parts", "under a key that a helper makes", 1.3],
  ["a-list-filled-to-a-bound.ts", "seventeen values", "nine values", 0.8],
  ["methods-that-a-helper-stores.js", "methods written in the literal", "methods that a helper stores", 1.3],
  [
    "a-commonjs-file-imported.js",
    "names imported from a CommonJS file",
    "members of the namespace of a CommonJS file",
    2.5,
  ],
];

describeTwins("everyday-twins", join(import.meta.dir, "everyday-twins"), rows, () => "main.ts");
