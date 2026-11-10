// Flags: --aot-testing=CheckWalkAtRunTime
// A call by a name that built-in classes have is served by a stub that looks at the kind of the receiver and takes the method to be as the class was made. Under the word that checks the walk the receiver is asked what it finds under the name: it must be that very function.
// Beside receivers as made stand one with a property of its own under the name, one of a class below that overrides it, and an object that is no built-in: the stub must leave those to the lookup.
// COUNTER: FastPathResultsVerified >= 100
const unseen = (0, eval)("(x) => x");
const keys = [{}, {}, {}];
const strong = new Map(), weak = new WeakMap(), own = new Map();
for (const key of keys) { strong.set(key, 1); weak.set(key, 2); own.set(key, 3); }
own.get = () => 30;
class Counting extends Map { get(key) { return (super.get(key) ?? 0) + 100; } }
const below = new Counting(); below.set(keys[0], 4);
function ask(one) { let sum = 0; for (let i = 0; i < 30; i++) sum += one.get(keys[i % 3]) ?? 0; return sum; }
function pick(i) { return keys[i % 3]; }
function askByValue(one) { let sum = 0; for (let i = 0; i < 30; i++) sum += one.get(pick(i)) ?? 0; return sum; }
for (const one of unseen([strong, weak, own, below, { get: () => 7 }])) console.log(ask(one), askByValue(one));
function find(all) { let out = ""; for (let turn = 0; turn < 10; turn++) { out = ""; for (const one of all) out += one.indexOf("a") + "," + one.slice(1).length + ";"; } return out; }
console.log(find(unseen([["b", "a"], "ba", new String("cba"), { indexOf: () => 9, slice: () => "xy" }])));
