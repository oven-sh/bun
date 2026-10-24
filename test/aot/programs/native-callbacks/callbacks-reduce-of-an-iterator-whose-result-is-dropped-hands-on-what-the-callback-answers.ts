// What the callback of Iterator.prototype.reduce() answers is its next accumulator. The program passes an instance as the first one and drops the result, and the callback answers a string once.
class Sum {
  total = 0;
  add(item: number): Sum | string {
    this.total += item;
    return item === 2 ? "text" : this;
  }
}

const log: unknown[] = [];
function step(sum: Sum | string, item: number): Sum | string {
  log.push(typeof sum === "string" ? sum.length : sum.total);
  return typeof sum === "string" ? new Sum() : sum.add(item);
}

[1, 2, 3, 4].values().reduce(step as any, new Sum() as any);
console.log(log.join());
