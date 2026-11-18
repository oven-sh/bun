const adder = (by: number) => (x: number) => x + by;
const scaler = (by: number) => (x: number) => x * by;
const list = [adder(1), scaler(3), adder(10), scaler(-1)];
function run(): number {
  let sum = 0;
  for (let i = 0; i < 40; i++) sum += list[i & 3](i);
  return sum;
}
console.log(run());
list[1] = adder(1000);
console.log(run());
