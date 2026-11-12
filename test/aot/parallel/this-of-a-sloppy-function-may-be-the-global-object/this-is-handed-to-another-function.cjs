function look(given) {
  return typeof given.process.finalization;
}
function who() {
  return look(this);
}
console.log(who());
