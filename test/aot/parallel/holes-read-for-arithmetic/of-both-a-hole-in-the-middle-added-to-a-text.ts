// a list of both, a hole in the middle: what is read is added to a text
function run(list: number[], w: any) {
  let t = 0, u = 1, n = 0;
  let last: unknown = "none";
  for (let i = 0; i < list.length; i++) { if (list[i] + "" === "undefined") n++; }
  return [t, u, n, String(last), String(w)].join(":");
}
const list: number[] = [1, 2.5, 3, 4.5, 5, 6.5];
delete list[3];
const seen: unknown[] = [];
for (let k = 0; k < 3; k++) seen.push(run(list, k === 1 ? "w" : 0));
seen.push(run([1, 2.5, 3, 4.5, 5, 6.5], 0));
console.log(seen.join());
