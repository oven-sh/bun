// Built-ins that turn an operand into a number are handed strings that are still in pieces. Such a string is made whole for that, which allocates, so a collection may come in the middle of the call.
// Flags: --aot-validate
// Env: BUN_JSC_collectContinuously=1
function least(a: string[]): string {
  const b = a as any;
  const x = a[0];
  const n = Math.min(...b);
  return n + "|" + x.length + "|" + a[0].length + "|" + a.length;
}
function dates(a: string[]): string {
  const b = a as any;
  return Date.UTC(b[0], b[1]) + "|" + new Date(0).setMonth(b[0]) + "|" + new Date(0).setHours(b[1]) + "|" + a[1].length;
}
const parts: string[] = JSON.parse('["1", "2", "3", "4"]');
let out = "";
for (let round = 0; round < 3000; round++) {
  let s = parts[round & 3];
  for (let i = 0; i < 900; i++) s = s + parts[(round + i) & 3];
  out = least([s, s + parts[1]]) + " " + dates([s + parts[2], s + parts[3]]);
}
console.log(out);
