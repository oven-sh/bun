function createMeter(limit) {
  var count;
  count = 0;
  function next() { count = count + 1; return count; }
  function isDone() { return count >= limit; }
  return { next, isDone };
}
const meter = createMeter(2);
console.log(meter.next(), meter.isDone(), meter.next(), meter.isDone());
