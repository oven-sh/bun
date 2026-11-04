let calls = 0, sum = 0;
function tick() { calls++; }
function take(first, second) { calls++; sum += first + second; }
function run(i) {
  tick.apply(null, [1, 2]);
  Reflect.apply(tick, null, [i, i]);
  take.apply(null, [i, 2]);
  Reflect.apply(take, null, [i, 2, 3]);
}
for (let i = 0; i < 300; i++) run(i);
console.log(calls, sum);
