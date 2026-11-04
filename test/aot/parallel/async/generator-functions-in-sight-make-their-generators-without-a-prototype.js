// COUNT: operation:operationAOTNewGenerator <= 200
// A generator function whose every call is in sight, whose generators go into iterations alone and that nobody asks for a name makes them below %GeneratorPrototype% itself: no object under `prototype`, no Structure,
// no entry of the run time. 6,000 functions of three texts are made here and called for the first time, and the run counts the entries of the operation that makes a generator with its prototype.
// A fourth text is asked for its `prototype` all the while, which costs the three nothing. The sister of generator-functions-that-nobody-asks-make-their-generators-without-a-prototype.js, whose functions unseen code has had.
let sum = 0, right = 0;
function walk(tag) {
  function* first() { const sent = yield tag + 1; yield tag + 2; return sent; }
  function* second() { for (let i = 0; i < 2; i++) yield tag + i; }
  function* third(depth) { yield depth; if (depth < 2) yield* third(depth + 1); }
  function* asked() { yield 1; }
  for (const value of first()) sum += value;
  sum += [...second()].length;
  const [head] = second();
  sum += head;
  for (const depth of third(0)) sum += depth;
  if (tag % 100 === 0) {
    const generator = asked();
    right += Object.getPrototypeOf(generator) === asked.prototype ? 1 : 0;
  }
}
for (let i = 0; i < 2000; i++) walk(i);
console.log(sum, right);
