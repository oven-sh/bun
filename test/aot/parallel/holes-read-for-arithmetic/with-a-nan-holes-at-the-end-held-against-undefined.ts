// a list with a nan, holes at the end: what is read is held against undefined
function run(list: number[], w: any) {
  let t = 0, u = 1, n = 0;
  let last: unknown = "none";
  for (let i = 0; i < list.length; i++) { if (list[i] === undefined) n++; }
  return [t, u, n, String(last), String(w)].join(":");
}
const list: number[] = [1, NaN, 3.5, 4, 5, 6];
list.length = 9;
const seen: unknown[] = [];
for (let k = 0; k < 3; k++) seen.push(run(list, k === 1 ? "w" : 0));
seen.push(run([1, NaN, 3.5, 4, 5, 6], 0));
console.log(seen.join());
