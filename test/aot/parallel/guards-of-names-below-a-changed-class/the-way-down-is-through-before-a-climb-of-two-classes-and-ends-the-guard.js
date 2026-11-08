// The guard of the name stands two classes below the changed class and nothing stands beside them: the way down reaches the guarded class in its second turn, when the climb from the one entry has come one class up.
// The changed class, the class between, a class of the climb, the guarded class: four looks, and the way down ends the guard.
// COUNTER: ClassGuardBitsEnded = 1
// COUNTER: ClassesLookedAtToEndGuardsOfNames = 4
const storeOver = (0, eval)('(Top) => { Top.prototype.tell = () => 2; }');
class Top { tell() { return 1; } }
class Mid extends Top { } class Leaf extends Mid { }
function ask(o) { let t = 0; for (let i = 0; i < 2; i++) t += o.tell(); return t; }
const leaf = new Leaf();
console.log(ask(leaf));
storeOver(Top);
console.log(ask(leaf));
