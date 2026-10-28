// @ts-nocheck
// As its neighbor without "very small": here the numbers lie next to zero, and each is asked for its type and turned into a text.
function inAField(a: (number | null)[]) {
  return new (class {
    v = a[0];
  })().v;
}
const read = inAField([null]) ?? inAField([1e-310]);
console.log("a field", typeof read, String(read));

function keyOfAGroup(a: (number | null)[]) {
  return [...Map.groupBy([1], () => a[0]).keys()].map(key => typeof key + " " + String(key));
}
console.log("the key of a group", keyOfAGroup([null]), keyOfAGroup([1e-310]));

function theSmallest(a: (number | null)[]) {
  return [...Map.groupBy([1], () => a[0]).keys()].map(key => typeof key);
}
console.log("the smallest", theSmallest([null]), theSmallest([5e-324]));
