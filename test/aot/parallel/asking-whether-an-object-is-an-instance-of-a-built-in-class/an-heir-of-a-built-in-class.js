// STATISTIC: ImageFunctionsEmitted <= 60
class Mine extends Set { size2() { return this.size * 2; } }
const mine = new Mine([1, 2]);
console.log(mine instanceof Set, new Set() instanceof Mine, mine instanceof Mine, mine.size2(), mine instanceof Function, Mine instanceof Function);
