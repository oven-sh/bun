// What the first store to `exports` lays under a name says nothing of the next one: the names are counted up, added to and stored again, by the file itself and by the file that requires it, with values of other kinds too.
const counter = require("./counter.cjs");
function run(times) {
  let last;
  for (let i = 0; i < times; i++) last = counter.bump();
  return last;
}
console.log(run(1000), counter.count, counter.rename("x"), counter.flip(), JSON.stringify(counter.read()));
counter.count = 2147483647;
console.log(counter.bump(), counter.count);
counter.count = 0.5;
console.log(counter.bump());
counter.count = -0;
console.log(Object.is(counter.read()[0], -0), counter.bump());
counter.count = "7";
console.log(counter.bump(), typeof counter.count);
counter.count = 10n;
console.log(String(counter.bump()), typeof counter.count);
counter.count = undefined;
console.log(counter.bump());
counter.count = { valueOf: () => 41 };
console.log(counter.bump(), typeof counter.count);
counter.label = 5;
console.log(counter.rename(1), typeof counter.label);
counter.isOn = "text";
console.log(counter.flip(), counter.flip());
delete counter.count;
console.log(counter.bump(), "count" in counter);
counter.count = 0;
console.log(run(3), JSON.stringify(counter.read()));
