// dates are written by toJSON: valid ones, an invalid one, one with a toISOString of its own, one of a subclass; the names of Date.prototype are listed in front and behind
class Stamp extends Date { toISOString() { return "stamp"; } }
function write(d) { return d.toJSON(); }
function names() { return Object.getOwnPropertyNames(Date.prototype).filter(name => name === "valueOf" || name === "toISOString" || name === "toJSON" || name === "getTime").join(); }
const own = new Date(0);
own.toISOString = () => "own";
const valued = new Date(0);
valued.valueOf = () => NaN;
console.log(names());
console.log(write(new Date(NaN)), names());
for (let turn = 0; turn < 3; turn++)
  console.log(write(new Date(86400000 * turn)), write(new Date(NaN)), write(new Date(8.64e15)), write(new Date(-1)), write(own), write(valued), write(new Stamp(5)), JSON.stringify({ d: new Date(1) }));
console.log(names());
console.log(Date.prototype.toJSON.call({ toISOString() { return "borrowed"; } }));
