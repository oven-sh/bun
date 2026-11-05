// List storage changes kind in a loop: compiled answers as plain.
function fill(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push(i === 3 ? 0.5 : i === 5 ? "s" : i === 7 ? undefined : i);
  let s = "";
  for (let i = 0; i < a.length; i++) s += typeof a[i][0] + String(a[i]) + ",";
  return s;
}
try {
  console.log(fill(4));
} catch (e) {
  console.log(e.constructor.name);
}
function kinds(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push(i === 3 ? 0.5 : i === 5 ? "s" : i === 7 ? undefined : i);
  return a.map(v => typeof v).join();
}
console.log(kinds(3), kinds(4), kinds(6), kinds(9));
