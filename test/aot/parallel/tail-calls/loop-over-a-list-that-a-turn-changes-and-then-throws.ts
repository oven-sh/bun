// a turn of a loop over a list makes the list longer or shorter, and a later turn throws
let seen = "";
function walk(list: number[], change: (list: number[], v: number) => void): string {
  for (const v of list) {
    seen += v;
    change(list, v);
  }
  return "done";
}
function grows(list: number[], v: number) {
  if (v === 1) list.push(4);
  if (v === 4) throw new Error("grown");
}
function shrinks(list: number[], v: number) {
  if (v === 1) list.length = 2;
  if (v === 3) throw new Error("never");
}
function deed(change: (list: number[], v: number) => void) {
  seen = "";
  try {
    return walk([1, 2, 3], change) + " " + seen;
  } catch (e) {
    return (e as Error).message + " " + seen;
  }
}
console.log(deed(() => {}));
for (let i = 0; i < 3; i++) console.log(deed(() => {}));
console.log(deed(grows));
console.log(deed(shrinks));
console.log(deed(() => {}));
