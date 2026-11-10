// Flags: --aot-testing=CheckProofsAtRunTime,CheckWalkAtRunTime
// The term stands exactly at the bound that the relation on the sum gives it: 4,294,967,295 - 1 - (-2,147,483,648). With the bound laid one short this program stops under the two words.
function control(a, b, n) {
  const from = a | 0;
  const limit = n >>> 0;
  let count = b >>> 0;
  let turns = 0;
  while (from + count < limit && turns < 8) { count += 1073741824; turns++; }
  return count + "/" + turns;
}
globalThis.kept = control;
console.log(control(-2147483648, 1073741822, 4294967295), control(0, 0, 5), control(-2147483648, 1073741821, 4294967295));
