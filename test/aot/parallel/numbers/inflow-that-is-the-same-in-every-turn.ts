// STATISTIC: InvariantPathsOfDoubles >= 1
// What comes into a tank in an hour is made of numbers that no turn changes, whole ones or others: as doubles they are reckoned with in front of the loop, and what an int32 would make of them, a lost minus or a sum that is cut, is nowhere to be seen.
class Tank {
  rate: number;
  hours: number;
  loss: number;
  constructor(rate: number, hours: number, loss: number) {
    this.rate = rate;
    this.hours = hours;
    this.loss = loss;
  }
}
let heat = 2;
let cold = 0.5;
function setHeat(by: any) {
  heat = Number(by);
  cold = heat / 3;
}
function inflow(tank: Tank, list: Float64Array): number {
  const rate = tank.rate;
  const hours = tank.hours;
  const loss = tank.loss;
  let sum = 0.5;
  for (let at = 0; at < list.length; at++) sum += list[at] * (rate * hours - loss);
  return sum;
}
function warm(list: number[]): number {
  let sum = 0;
  for (let at = 0; at < list.length; at++) sum += Math.sqrt(list[at]) * (heat * cold + heat);
  return sum;
}
function told(list: Float64Array, rate: any, hours: any): number {
  rate = +rate;
  hours = +hours;
  let sum = 0;
  for (let at = 0; at < list.length; at++) {
    sum = sum * 0.5 + list[at];
    sum += rate * hours - rate;
  }
  return sum;
}
function held(box: any, list: Float64Array): number {
  const rate = box.rate;
  const hours = box.hours;
  if (typeof rate !== "number" || typeof hours !== "number") return -1;
  let sum = -0;
  for (let at = 0; at < list.length; at++) sum += list[at] / (rate * hours + rate);
  return sum;
}
// the numbers change behind the first turn
function changed(box: any, list: Float64Array): number {
  let sum = 0;
  for (let at = 0; at < list.length; at++) {
    sum += list[at] * (box.rate * box.hours - box.loss);
    if (at === 2) box.rate = box.rate + 0.5;
  }
  return sum;
}
const list = Float64Array.from({ length: 30 }, (_, at) => at / 4);
const plain = Array.from({ length: 30 }, (_, at) => at / 4);
const rates = [2, 0.5, 3, 7.25];
const hours = [4, 3, 1.5];
const losses = [1, 0.125];
let all = 0;
for (let round = 0; round < 400; round++) {
  const rate = rates[round % 4];
  setHeat(rate);
  all += inflow(new Tank(rate, hours[round % 3], losses[round % 2]), list) + warm(plain) + told(list, rate, hours[round % 3]) + held({ rate, hours: hours[round % 3] }, list) + changed({ rate, hours: 2, loss: 1 }, list);
}
console.log(all);
const show = (value: number) => (Object.is(value, -0) ? "-0" : String(value));
const few = Float64Array.of(1, 0.5, -0, 3, 1e-300);
for (const rate of [0, -0, -3, 65536, 2147483647, -2147483648, 1e200, NaN, Infinity, "5" as any, null as any, undefined as any]) {
  for (const hour of [0, -0, 65536, -1, 0.1, 2147483647]) {
    setHeat(rate);
    console.log(String(rate), show(hour), [inflow(new Tank(rate, hour, 0), few), inflow(new Tank(hour, rate, -0), few), warm([1, 4]), told(few, rate, hour), held({ rate, hours: hour }, few), changed({ rate, hours: hour, loss: hour }, few)].map(show).join(" "));
  }
}
for (const box of [{ rate: 2n, hours: 3n, loss: 1n }, {}, { rate: 1, hours: { valueOf: () => 4 }, loss: 2 }]) {
  for (const work of [(box: any) => inflow(box, few), (box: any) => told(few, box.rate, box.hours), (box: any) => held(box, few), (box: any) => changed(box, few)]) {
    try {
      console.log(show(work(box)));
    } catch (error: any) {
      console.log(error.constructor.name);
    }
  }
}
