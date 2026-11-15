const original = process.nextTick;
let queued = 0;
process[["next", "Tick"].join("")] = function (...operands) {
  queued++;
  return original.apply(this, operands);
};
console.log(process.stdin.isTTY === true, queued);
