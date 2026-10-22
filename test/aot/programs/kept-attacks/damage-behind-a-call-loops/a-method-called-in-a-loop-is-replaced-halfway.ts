// A loop calls a method of an object and another function in every iteration. In one iteration that function replaces the method on the prototype object, and two iterations later it puts the old one back.
class Counter {
  count = 0;
  bump(): number {
    return ++this.count;
  }
}
const original = Counter.prototype.bump;

let strikes = false;
function between(index: number): number {
  if (strikes && index === 3) {
    Counter.prototype.bump = function (this: Counter) {
      this.count += 100;
      return -1;
    };
  }
  if (strikes && index === 5) Counter.prototype.bump = original;
  return 0;
}

function run(counter: Counter): string {
  let text = "";
  for (let index = 0; index < 8; index++) {
    text += counter.bump();
    between(index);
    text += "," + counter.bump() + " ";
  }
  return text + counter.count;
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = run(new Counter());
  if (strikes || round === 0) console.log(round + ": " + line);
}
