// Under: --aot-check=Validate: the store in line under the written index -1 stood at offset -8 of the elements, in a block that no way leads into, and the check that no remembered load stands over a stored word stopped the build.
"use strict";
const kinds = {};
kinds[(kinds["Plain"] = 0)] = "Plain";
kinds[(kinds["Missing"] = -1)] = "Missing";
kinds[(kinds["Other"] = 1)] = "Other";
console.log(kinds[-1], kinds[0], kinds[1], kinds.Missing, Object.keys(kinds).join());
function fill(first) {
  const row = { name: first };
  row[0] = first;
  row[1] = first + 1;
  row[-1] = "below";
  row[-2] = row[-1] + row[0];
  row[1] = row[0] + row[1];
  return Object.keys(row).join() + "=" + row[-1] + "," + row[-2] + "," + row[0] + "," + row[1];
}
for (const first of JSON.parse("[1, 20, 300]")) console.log(fill(first));
