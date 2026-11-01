class Mine extends TypeError {}
try {
  null.x;
} catch (e) {
  Reflect.set(e.constructor, "extra", 41);
}
function read() {
  return [TypeError.extra, Mine.extra, "extra" in Mine].join();
}
console.log(read());
