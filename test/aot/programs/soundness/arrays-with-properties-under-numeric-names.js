const list = [1, 2, 3];
list[-1] = "minus";
list[1.5] = "half";
list[4294967295] = "past the last index";
function at(a, i) {
  return a[i];
}
function has(a, i) {
  return i in a;
}
let text = "";
for (const i of [-1, 1.5, 0, 3, -0, 4294967295, 4294967294]) text += at(list, i) + "," + has(list, i) + ";";
console.log(text);
function sumDown(a) {
  let t = "";
  for (let i = a.length - 1; i >= -1; i--) t += a[i];
  return t;
}
console.log(sumDown(list));
function halves(a) {
  let t = "";
  for (let i = 0; i < 2; i += 0.5) t += a[i] + "|";
  return t;
}
console.log(halves(list));
function store(a, i, v) {
  a[i] = v;
  return a[i];
}
console.log(store(list, -1, "again"), list[-1], store(list, 1.5, "more"), list[1.5], list.length, Object.keys(list).join());
delete list[-1];
console.log(at(list, -1), has(list, -1), sumDown(list));
