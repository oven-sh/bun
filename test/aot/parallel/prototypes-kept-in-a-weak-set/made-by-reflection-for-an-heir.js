const seen = [];
class Mine extends WeakSet { add(value) { seen.push(value); return super.add(value); } }
const kept = Reflect.construct(WeakSet, [[Object.prototype, Error.prototype]], Mine);
console.log(seen.length, seen.map(each => typeof each.toString).join(), kept.has(Error.prototype));
