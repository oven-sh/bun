// RUN: link
// CHECK-NOT: fields=[{key="east"{{*}}{key="north"{{*}}{key="shared"{{*}}{key="south"
// CHECK: function {{*}}name="names" {{*}}parameters=[{type=undefined|null|L{{*}}|L{{*}}|L{{*}} flags=[IsExpected]}]

// TypeScript's widening of a union gives each of the three literals the names of the other two, as properties that are undefined: a type that no object of the program has,
// and n literals with a name of their own cost the build n * n properties; a spread of an element copies them all once more. None of the three has every name, so each keeps its own.
const rows = [
  { north: 1, shared: 10 },
  { south: 2, shared: 20 },
  { east: 3, shared: 30 },
];
let sum = 0;
for (const row of rows) sum += row.shared;

function names(row) {
  return Object.keys(row).length;
}

for (const row of rows) sum += names(row);
console.log(sum);
