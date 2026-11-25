// STATISTIC: FunctionsLowered <= 400
const doubled = [1, 2, 3].values().map(value => value * 2).filter(value => value > 2).take(2).toArray();
console.log(doubled.join(), [4, 5].entries().toArray().length, Iterator.from({ next() { return { done: true }; } }).toArray().length);
