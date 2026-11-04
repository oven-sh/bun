// a list of fractions, a hole at the start: what is read is multiplied
function run(list: number[], w: any) {
  let t = 0, u = 1, n = 0;
  let last: unknown = "none";
  for (let i = 0; i < list.length; i++) { t += 1; u *= list[i]; }
  return [t, u, n, String(last), String(w)].join(":");
}
const list: number[] = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5];
delete list[0];
const seen: unknown[] = [];
for (let k = 0; k < 3; k++) seen.push(run(list, k === 1 ? "w" : 0));
seen.push(run([1.5, 2.5, 3.5, 4.5, 5.5, 6.5], 0));
console.log(seen.join());
