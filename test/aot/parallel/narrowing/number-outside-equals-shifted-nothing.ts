// Numbers come out of parsed text. One that equals itself shifted right by nothing is a whole number that fits in 32 bits without a sign, and a closure takes it.
// Flags: --aot-validate
const given: number[] = JSON.parse("[0.5, 3, 4294967295, 4294967296, -1, 0, -0]");
function once(index: number): string {
  const a: number = given[index];
  if (a >>> 0 === a) return String((() => a)());
  return "-";
}
function twice(index: number): string {
  const a: number = given[index];
  if (a >>> 0 === a) {
  }
  if (a >>> 0 === a) return String((() => a)());
  return "-";
}
for (let index = 0; index < 9; index++) console.log(index, once(index), twice(index));
