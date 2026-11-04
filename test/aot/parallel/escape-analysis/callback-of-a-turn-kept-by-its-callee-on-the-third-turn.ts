// Each turn of a loop hands a closure over its own scope to a function that calls it, and that on the third turn keeps it as well; what was kept is called when the loop has ended.
const list: Array<() => number> = [];
function callAndMaybeKeep(f: () => number, keep: boolean): number {
  if (keep) list.push(f);
  return f();
}
function deed(n: number): string {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += callAndMaybeKeep(() => i * 2, i === 2);
  let out = String(sum);
  for (let k = 0; k < list.length; k++) out += " " + String(list[k]());
  return out;
}
console.log(deed(2));
console.log(deed(6));
for (let turn = 0; turn < 300; turn++) deed(2);
console.log(deed(3));
