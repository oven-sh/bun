const seen = [];
class Mine extends WeakSet { constructor() { super([Object.prototype, Error.prototype]); } add(value) { seen.push(value); return super.add(value); } }
const kept = new Mine();
console.log(seen.length, seen.map(each => Object.getOwnPropertyNames(each).length > 3).join(), kept.has(Error.prototype));
