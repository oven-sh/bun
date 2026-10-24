export function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

export function add(list) {
  return list.push(9);
}

export function walk(list) {
  const seen = [];
  for (const value of list) seen.push(value);
  return seen;
}

export const doubled = list => list.map(value => value * 2);

export function firstTwo([first, second]) {
  return [first, second];
}

export class Basket {
  constructor(items) {
    this.items = items;
  }
  summary() {
    return [this.items.length, this.items[0], total(this.items)];
  }
}
