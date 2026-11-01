class Mine extends TypeError {}
try {
  null.x;
} catch (e) {
  Object.assign(e.constructor, { extra: 41 });
}
function read() {
  return [TypeError.extra, Mine.extra].join();
}
console.log(read());
