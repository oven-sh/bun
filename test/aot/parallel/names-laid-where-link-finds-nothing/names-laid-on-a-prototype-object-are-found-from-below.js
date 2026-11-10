// Under: --aot-check=Validate: a name that no class declares is laid on a prototype object: a lookup from below may not be said to find nothing
class Kind { one() { return 1; } }
class Heir extends Kind {}
class Answers { constructor(given) { return given; } }
class Stamp extends Answers { then = 2; extra = 3; }
new Stamp(Kind.prototype);
function read(object) { return object.extra; }
async function wait(object) { return await object; }
console.log(read(new Kind()), read(new Heir()));
wait(new Heir()).then(value => console.log(typeof value));
