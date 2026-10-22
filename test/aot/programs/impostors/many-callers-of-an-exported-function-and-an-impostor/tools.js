export function sum(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

export const double = n => n * 2;

export default function span(point) {
  return point.x - point.y;
}

export function shout(text) {
  return text.toUpperCase();
}

export function low(n) {
  return n & 15;
}

export let step = function (n) {
  return n + 1;
};

export function replaceStep(f) {
  step = f;
}

export class Counter {
  constructor(start) {
    this.count = start;
  }

  add(n) {
    this.count += n;
    return this.count;
  }
}
