TypeError.list = [1, 2];
function swap(e) {
  e.constructor.list = { length: 3 };
}
process.on("uncaughtException", e => {
  swap(e);
  console.log(read());
});
function read() {
  return TypeError.list.length;
}
setTimeout(() => null.x, 0);
