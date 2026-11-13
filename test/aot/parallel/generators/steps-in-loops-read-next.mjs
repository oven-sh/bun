function* counted() { yield 1; yield 2; }
const inherited = Object.getPrototypeOf(counted.prototype);
function members() {
  Object.assign({}, inherited);
  return Reflect.ownKeys(inherited).map(key => String(key)).join();
}

class Own {
  static *steps() { yield 1; }
}

// A generator with a next of its own reads no other.
function stepOwn() {
  const own = counted();
  own.next = () => ({ done: true, value: "own" });
  const values = [];
  for (let index = 0; index < 3; index++) values.push(own.next().value);
  return values.join();
}

function drain(generator) {
  let total = 0;
  let step;
  while (!(step = generator.next()).done) total += step.value;
  return total;
}

console.log(stepOwn());
if (inherited.return) console.log("return");
for (const listed of [inherited]) console.log(listed === inherited, Own.steps().next().value);
console.log(drain(counted()));
if (inherited.throw) console.log("throw");
console.log(members());
