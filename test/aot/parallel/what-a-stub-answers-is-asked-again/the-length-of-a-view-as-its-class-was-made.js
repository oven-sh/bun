// Flags: --aot-testing=CheckWalkAtRunTime
// `length` read by name off a view over a buffer is answered by the kind of the cell where the view is as made. What stands above the views under the name is an accessor: under the word that checks the walk the view is asked what it finds, and the getter must be the one that the class was made with. It is not run.
// Beside views as made stand a view with a property of its own, one of a class below with a getter of its own, a list, a text and a plain object.
// COUNTER: FastPathResultsVerified >= 20
const unseen = (0, eval)("(x) => x");
const own = new Uint8Array(3); Object.defineProperty(own, "length", { value: 40 });
class Longer extends Float64Array { get length() { return super.length + 100; } }
function count(one) { let sum = 0; for (let i = 0; i < 10; i++) sum += one.length; return sum; }
for (const one of unseen([new Uint8Array(5), new Float64Array(2), own, new Longer(1), [1, 2], "abc", { length: 6 }, new Uint8Array(new ArrayBuffer(8, { maxByteLength: 16 }))])) console.log(count(one));
