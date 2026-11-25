// a sloppy wrapper stores to a parameter, which its arguments object shows, in front of handing the object on
function target() {
  return arguments.length + "/" + Array.prototype.join.call(arguments);
}
function wrap(a, b) {
  a = 7;
  return target.apply(this, arguments);
}
function deed(count) {
  if (count === 0) return wrap();
  if (count === 1) return wrap(1);
  if (count === 2) return wrap(1, 2);
  return wrap(1, 2, 3);
}
console.log(deed(2));
for (let i = 0; i < 4; i++) console.log(deed(i));
console.log(deed(1));
