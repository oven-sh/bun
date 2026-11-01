// Flags: --aot-validate
function made() {
  return new process.nextTick(() => console.log("queued by new"));
}
console.log(typeof made());
console.log(Object.keys(process.nextTick).length);
process.nextTick.extra = 1;
process.nextTick(() => console.log("queued by a call", process.nextTick.extra));
Object.freeze(process.nextTick);
process.nextTick(() => console.log("queued behind a freeze", Object.isFrozen(process.nextTick)));
