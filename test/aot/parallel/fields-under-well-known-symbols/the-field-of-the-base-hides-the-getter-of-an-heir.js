class Base { [Symbol.toStringTag] = JSON.parse('"own"'); }
class Loud extends Base { get [Symbol.toStringTag]() { return "getter"; } }
class First extends Base {}
class Second extends Base {}
class Third extends Base {}
class Fourth extends Base {}
function tagOf(loud) { return loud[Symbol.toStringTag]; }
const louds = [];
for (let i = 0; i < 3; i++) louds.push(new Loud());
const others = [new First(), new Second(), new Third(), new Fourth()];
console.log(tagOf(new Loud()), others.length, louds.length, Object.prototype.toString.call(new Loud()), louds.map(tagOf).join());
