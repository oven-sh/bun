// The entry of a function for callers that know nothing of it tests and unboxes each parameter of type number. On x86-64 one call of a stub does that for a parameter, and an entry that does nothing else falls into its function.
// ENTRY-SIZE< oneNumber 48 8
// ENTRY-SIZE< threeNumbers 120 18
// ENTRY-SIZE< behindAString 84 32
function oneNumber(a: number): number {
  return a + 1;
}
function threeNumbers(a: number, b: number, c: number): number {
  return a + b * 2 + c * 4;
}
function behindAString(s: string, a: number): string {
  return s + a;
}
const table: Record<string, Function> = { oneNumber, threeNumbers, behindAString };
for (const name of Object.keys(table)) {
  for (const number of [0, -0, 1, -1, 0.5, 2147483647, -2147483648, 2147483648, NaN, Infinity]) {
    console.log(name, name === "behindAString" ? table[name]("s", number) : table[name](number, 1.5, number));
  }
}
