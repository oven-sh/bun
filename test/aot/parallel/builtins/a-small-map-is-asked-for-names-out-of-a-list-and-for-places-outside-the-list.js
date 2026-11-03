// A small Map and a small Set are asked in a hot loop for what a list holds at a place. Half of the places lie outside the list,
// so the key is one of four written strings or undefined. Between the rounds undefined and null become keys and go again.
const ages = new Map([["ann", 30], ["bob", 25], ["cy", 41], ["dee", 19]]);
const known = new Set(["ann", "cy"]);
const names = ["ann", "bob", "cy", "dee"];
const orNull = ["ann", null, "cy", null, "eve"];
for (let round = 0; round < 5; round++) {
  let sum = 0;
  let missing = 0;
  let inMap = 0;
  let inSet = 0;
  for (let i = 0; i < 100000; i++) {
    const name = names[i & 7];
    const age = ages.get(name);
    if (age === undefined) missing++;
    else sum = (sum + age) | 0;
    if (ages.has(name)) inMap++;
    if (known.has(name)) inSet++;
  }
  let sumOrNull = 0;
  for (let i = 0; i < 100000; i++) sumOrNull = (sumOrNull + (ages.get(orNull[i % 6]) ?? 1000)) | 0;
  console.log(round, sum, missing, inMap, inSet, sumOrNull);
  if (round === 0) {
    ages.set(undefined, 7);
    known.add(undefined);
  } else if (round === 1) {
    ages.set(null, 9);
    known.add(null);
  } else if (round === 2) {
    ages.delete(undefined);
    known.delete(undefined);
  } else if (round === 3) {
    ages.delete(null);
    ages.set("eve", 3);
  }
}
