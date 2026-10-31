const nextTick = process.nextTick;
let calls = 0;
process.nextTick = function (...operands) {
  calls++;
  return nextTick.apply(this, operands);
};
console.log(process.stdin.fd, calls);
