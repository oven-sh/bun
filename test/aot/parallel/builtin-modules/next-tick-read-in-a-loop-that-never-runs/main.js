// No read happens, so the module imported later creates the tick queue.
function spin(turns) {
  let last;
  for (let i = 0; i < turns; i++) last = process.nextTick;
  return last;
}
spin(process.argv.length - process.argv.length);
console.log((await (await import("./first.js")).order).join(", "));
