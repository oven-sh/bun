// The read creates the tick queue even though the only call of what it read is skipped.
function maybeQueue(wanted) {
  const tick = process.nextTick;
  if (wanted) tick(() => {});
}
maybeQueue(process.argv.length > 100);
console.log((await (await import("./first.js")).order).join(", "));
