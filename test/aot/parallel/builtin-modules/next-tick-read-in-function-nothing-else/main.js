// The call stays: the read inside it creates the tick queue.
function touch() {
  process.nextTick;
}
touch();
console.log((await (await import("./first.js")).order).join(", "));
