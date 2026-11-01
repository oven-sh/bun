// The call stays: the read inside it creates the tick queue.
function getTick() {
  return process.nextTick;
}
getTick();
console.log((await (await import("./first.js")).order).join(", "));
