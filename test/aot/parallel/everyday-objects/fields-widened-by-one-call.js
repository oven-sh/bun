// A whole number in a field of many instances, a fraction or null in one of them
class Sample {
  constructor(n) {
    this.n = n;
    this.count = 1;
  }
}
function widen(size, value) {
  const list = [];
  for (let i = 0; i < size; i++) list.push(new Sample(i));
  list[1].n = value;
  list[0].count += value;
  let sum = 0;
  for (let i = 0; i < size; i++) sum += list[i].n + list[i].count;
  return sum + " " + list.map(one => one.n).join() + " " + typeof list[1].n;
}
console.log(widen(3, 5));
console.log(widen(3, 0.5));
console.log(widen(4, null));
