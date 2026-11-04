// a list of int32s, undefined is stored: what is read is held against null loosely
function run(list: number[], w: any) {
  let t = 0, u = 1, n = 0;
  let last: unknown = "none";
  for (let i = 0; i < list.length; i++) { if (list[i] == null) n++; }
  return [t, u, n, String(last), String(w)].join(":");
}
const list: number[] = [1, 2, 3, 4, 5, 6];
(list as unknown[])[2] = undefined;
const seen: unknown[] = [];
for (let k = 0; k < 3; k++) seen.push(run(list, k === 1 ? "w" : 0));
seen.push(run([1, 2, 3, 4, 5, 6], 0));
console.log(seen.join());
