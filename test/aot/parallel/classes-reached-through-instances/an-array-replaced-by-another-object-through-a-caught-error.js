TypeError.list = [1, 2];
try {
  null.x;
} catch (e) {
  e.constructor.list = { length: 3 };
}
function read() {
  return TypeError.list.length;
}
console.log(read());
