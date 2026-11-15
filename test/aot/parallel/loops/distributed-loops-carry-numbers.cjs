// Loops of many stores far apart, whose integers come round and are read as numbers.
const numbers = new Float64Array(16384);
const log = [];
function oneComesRound(end) {
  let previous = 3;
  for (let i = 0; i < end; i += 32) {
    const next = (i * 5) & 31;
    numbers[i] = previous * 0.5;
    numbers[i + 512] = next * 0.25;
    numbers[i + 1024] = 1.5;
    numbers[i + 1536] = 2.5;
    numbers[i + 2048] = 3.5;
    numbers[i + 2560] = 4.5;
    numbers[i + 3072] = 5.5;
    numbers[i + 3584] = 6.5;
    numbers[i + 4096] = 7.5;
    previous = next;
  }
}
function twoComeRound(last) {
  let previous = 3, earlier = 9;
  for (let i = 0; i < 500; i += 20) {
    const next = (i * 5) & 31;
    numbers[i] = previous * 0.5;
    numbers[i + 512] = next * 0.25;
    numbers[i + 1024] = earlier * 0.125;
    numbers[i + 1536] = 2.5;
    numbers[i + 2048] = 3.5;
    numbers[i + 2560] = 4.5;
    numbers[i + 3072] = 5.5;
    numbers[i + 3584] = 6.5;
    numbers[i + 4096] = last;
    earlier = previous;
    previous = next;
  }
}
for (const end of [480, 320, 33, 0]) {
  numbers.fill(0);
  oneComesRound(end);
  for (let i = 0; i < 480; i += 32) log.push(numbers[i], numbers[i + 512], numbers[i + 4096]);
}
for (const last of [1.5, 2.5]) {
  twoComeRound(last);
  for (let i = 0; i < 500; i += 20) log.push(numbers[i], numbers[i + 512], numbers[i + 1024], numbers[i + 4096]);
}
console.log(log.join());
