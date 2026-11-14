// -1, 1.5 and NaN, made at run time, add a NAME to a list. These lists go nowhere: only the function that makes them holds them, or a callee that takes them apart.
const zero = process.argv.length > 9 ? 1 : 0;
function local(k) {
  const a = [1, 2, 3];
  a[k] = 7;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i];
  return sum + " " + a.length + " " + a[k];
}
console.log(local(-1 - zero), local(1.5 + zero), local(zero / zero), local(1 + zero), local(3 + zero), local(4294967295 + zero));
function fill(list, k, value) { list[k] = value; return list.length; }
function handed(k) {
  const a = [1, 2];
  const length = fill(a, k, 5);
  return length + " " + a[0] + " " + a[1] + " " + a[k] + " " + a.map(x => x * 2).join();
}
console.log(handed(-1 - zero), handed(0.5 + zero), handed(zero / zero), handed(zero), handed(2 + zero));
function twice(k) {
  const a = [];
  for (let i = 0; i < 4; i++) a[i - k] = i;
  let names = 0;
  for (const name in a) names++;
  return a.length + " " + names + " " + a.indexOf(3) + " " + a.includes(0);
}
console.log(twice(zero), twice(2 + zero), twice(0.5 + zero));
