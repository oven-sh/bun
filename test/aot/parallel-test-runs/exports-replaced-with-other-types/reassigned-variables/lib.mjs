export let count = 1;
export let ratio = 0.5;
export let label = "a";
export let flag = true;
export let box = { v: 1 };
export let list = [1, 2, 3];
export function double(n) { return n * 2; }
export function bump() {
  count = count + 1;
  ratio = ratio * 2;
  label = label + "b";
  flag = !flag;
  box = { v: box.v + 1 };
  list = [list.length, 1];
}
export function readAll() {
  return [count + 1, ratio + 0.5, label.length, flag === true, box.v, list.length, double(4)].join(" ");
}
export function sumInLoop(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += count + ratio;
  return sum;
}
