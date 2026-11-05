class Base { constructor(n) { this.n = n; } }
class Apple extends Base { one() { return 1; } }
class Berry extends Base { two() { return 2; } }
class Cherry extends Base { three() { return 3; } }
class Plum extends Base { four() { return 4; } }
function take(o) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  for (let i = 0; i < 3; i++) work += o.n;
  return work;
}
function fromApple(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return take(new Apple(n)) + work;
}
function fromBerry(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return take(new Berry(n)) + work;
}
function fromStranger(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return take({ n, stranger: true }) + work;
}
let total = new Cherry(1).three() + new Plum(2).four();
for (let turn = 0; turn < 200; turn++) total += fromApple(turn) + fromBerry(turn) + fromStranger(turn);
console.log(total);
