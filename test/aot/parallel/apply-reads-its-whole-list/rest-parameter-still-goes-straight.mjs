let calls = 0, sum = 0;
function tick() { calls++; }
function take(first, second) { calls++; sum += first + (second === undefined ? 100 : second); }
function wrapTick(...rest) { return tick.apply(this, rest); }
function wrapTake(...rest) { return take.apply(this, rest); }
function wrapArguments() { return tick.apply(this, arguments); }
for (let i = 0; i < 300; i++) {
  wrapTick(i, i, i);
  wrapTake(i);
  wrapTake(i, 1, 2);
  wrapArguments(i, i);
}
console.log(calls, sum);
