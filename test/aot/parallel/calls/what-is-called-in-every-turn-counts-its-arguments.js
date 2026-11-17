// A callee that reads `arguments` or a rest parameter is told how many arguments the call passes, also where the call goes straight to its code.
function counted() {
  return arguments.length;
}
function rest(first, ...others) {
  return others.length * 10 + (first === undefined ? 1 : 0);
}
function last() {
  return arguments[arguments.length - 1];
}
function none(callback, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += callback();
  return sum;
}
function one(callback, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += callback(i);
  return sum;
}
function three(callback, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += callback(i, i + 1, i + 2);
  return sum;
}
function seven(callback, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += callback(i, 1, 2, 3, 4, 5, i + 6);
  return sum;
}
for (const callee of [counted, rest, last]) {
  console.log(callee.name, String(none(callee, 4)), one(callee, 4), three(callee, 4), seven(callee, 4));
}
console.log([1, 2, 3].map(counted).join(), [1, 2, 3].map(rest).join());
console.log([4, 5].some(last), [4, 5].filter(counted).join());
