// Flags: --aot-testing=CheckProofsAtRunTime,CheckWalkAtRunTime
// The term stands exactly at the bound that the relation on the sum gives it: 4,294,967,295 - 1 - (-2,147,483,648). With the bound laid one short this program stops under the two words.
function control(list, a, b, n) {
  const from = a | 0;
  const limit = n >>> 0;
  const count = (b >>> 0) + (b >>> 0) - 2147483648;
  if (from + count < limit) return list[count];
  return "not below";
}
globalThis.kept = control;
console.log(control([1, 2, 3], -2147483648, 4294967295, 4294967295), control([1, 2, 3], 0, 1073741825, 9), control([1, 2, 3], 5, 1073741825, 2));
