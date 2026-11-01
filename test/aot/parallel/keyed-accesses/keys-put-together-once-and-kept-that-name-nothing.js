// Keys that are put together once and kept: `names.push(prefix + k)`, then `record[name]` and `name in record` again and again. Half of them name nothing anywhere, so no such name exists.
// The first look under such a key makes none. A key that comes again gets its name, and from then on no look under it leaves compiled code and its stubs.
// COUNT: operation:operationAOTGetByValGeneric <= 400
// COUNT: operation:operationAOTInByValGeneric <= 400
const above = {};
const record = Object.create(above);
const names = [];
const pieces = [];
const whole = "first_setting,second_setting,third_setting,fourth_setting,fifth_setting,sixth_setting";
for (let k = 0; k < 16; k++) {
  if (k & 1) record["EXAMPLE_KEY_" + k] = String(k);
  names.push("EXAMPLE_KEY_" + k);
}
for (const piece of whole.split(",")) pieces.push(piece.toUpperCase());
record[pieces[1]] = "second";
function lengthUnder(key) {
  const found = record[key];
  return found === undefined ? 0 : found.length;
}
function isNamed(key) {
  return key in record ? 1 : 0;
}
function turn(i) {
  return lengthUnder(names[i & 15]) + lengthUnder(names[(i + 5) & 15]) + isNamed(names[(i + 10) & 15]) + lengthUnder(pieces[i % 6]) + isNamed(pieces[(i + 1) % 6]);
}
function sumOf(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum = (sum + turn(i)) | 0;
  return sum;
}
console.log(sumOf(20000));
// What had no name gets one later, by another string of the same text, on the record and above it.
record["EXAMPLE_KEY_" + 4] = "four";
above["EXAMPLE_KEY_" + 6] = "six!";
console.log(lengthUnder(names[4]), isNamed(names[4]), lengthUnder(names[6]), isNamed(names[6]), lengthUnder(names[8]), isNamed(names[8]));
console.log(sumOf(20000));
delete record[names[4]];
delete above[names[6]];
console.log(lengthUnder(names[4]), isNamed(names[4]), lengthUnder(names[6]), isNamed(names[6]));
console.log(sumOf(20000));
