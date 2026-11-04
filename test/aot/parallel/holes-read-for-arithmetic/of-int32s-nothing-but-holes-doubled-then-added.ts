// a list of int32s, nothing but holes: what is read is doubled then added
function run(list: number[], w: any) {
  let t = 0, u = 1, n = 0;
  let last: unknown = "none";
  for (let i = 0; i < list.length; i++) { t += list[i] * 2; }
  return [t, u, n, String(last), String(w)].join(":");
}
const list: number[] = [1, 2, 3, 4, 5, 6];
list.length = 0; list.length = 4;
const seen: unknown[] = [];
for (let k = 0; k < 3; k++) seen.push(run(list, k === 1 ? "w" : 0));
seen.push(run([1, 2, 3, 4, 5, 6], 0));
console.log(seen.join());
