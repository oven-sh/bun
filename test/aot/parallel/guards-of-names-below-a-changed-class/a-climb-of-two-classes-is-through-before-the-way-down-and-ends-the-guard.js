// The guard of the name stands two classes below the changed class, and three more classes stand right below it, which the way down takes first.
// The way down and the way up from the one entry go in step: the changed class, a spare class, the class between, a spare class, the changed class reached: five looks, and the climb, kept over two turns, ends the guard.
// A climb that forgot between turns how far it had come, or ended nothing on arriving, would leave the old method called: 2 and 2.
// COUNTER: ClassGuardBitsInvalidated = 1
// COUNTER: ClassesVisitedForGuardInvalidation = 5
const storeOver = (0, eval)('(Top) => { Top.prototype.tell = () => 2; }');
class Top { tell() { return 1; } }
class Mid extends Top { } class Leaf extends Mid { }
class Spare1 extends Top { } class Spare2 extends Top { } class Spare3 extends Top { }
function ask(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; }
const leaf = new Leaf();
console.log(ask(leaf));
storeOver(Top);
console.log(ask(leaf));
