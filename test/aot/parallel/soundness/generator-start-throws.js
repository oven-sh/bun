// Flags: --aot-check=verify-each-pass,validate-references
// A generator takes its parameters apart when it is called, not at the first step. Where that always throws, the body put in line never comes back, and what stands behind the call is never reached.
function note(...parts) { console.log(parts.join(" ")); }
function tell(label, value) { note("runs", label); return value; }
function fail(label) { note("throws", label); throw new RangeError(label); }
(function alwaysThrows() {
  try {
    function* takes({ hidden: { inner } }) { note("body", inner); }
    const walk = takes({ c: 1 });
    note("made");
    walk.next();
  } catch (error) { note("THROWS", error.constructor.name); }
})();
(function throwsBehindAKeyThatRuns() {
  try {
    function* takes({ [tell("key", "c")]: last, hidden: { inner = tell("default", 1) } }) { note("body", inner, last); }
    const walk = takes({ c: 1 });
    note("made");
    walk.next();
  } catch (error) { note("THROWS", error.constructor.name); }
})();
(function aDefaultThrows() {
  try {
    function* takes(a = fail("default")) { note("body", a); }
    const walk = takes();
    note("made");
    walk.next();
  } catch (error) { note("THROWS", error.constructor.name, error.message); }
})();
(function throwsForOneCallOfTwo() {
  function* takes({ hidden: { inner } }) { note("body", inner); yield inner; }
  for (const given of [{ hidden: { inner: 7 } }, { c: 1 }, { hidden: { inner: 8 } }]) {
    try {
      const walk = takes(given);
      note("made");
      note("step", JSON.stringify(walk.next()), JSON.stringify(walk.next()));
    } catch (error) { note("THROWS", error.constructor.name); }
  }
})();
(function neverThrows() {
  try {
    function* takes({ a = tell("default", 1) }) { note("body", a); }
    const walk = takes({});
    note("made");
    note("step", JSON.stringify(walk.next()));
  } catch (error) { note("THROWS", error.constructor.name); }
})();
(function throwsInALoopOverIt() {
  try {
    function* takes({ hidden: { inner } }) { yield inner; }
    for (const each of takes({ c: 1 })) note("each", each);
    note("behind the loop");
  } catch (error) { note("THROWS", error.constructor.name); } finally { note("finally"); }
})();
(function steppedOnce() {
  function* counts(from) { for (let i = from; ; i++) yield { n: i }; }
  function step(walk) { const result = walk.next(); return result.done ? -1 : result.value.n | 0; }
  let sum = 0;
  for (let turn = 0; turn < 3; turn++) { const walk = counts(12 + turn); sum += step(walk); }
  note("stepped once", sum);
})();
(function steppedTwiceAndLeft() {
  function* counts(from) { try { for (let i = from; ; i++) yield i; } finally { note("left"); } }
  const walk = counts(5);
  note("steps", walk.next().value, walk.next().value, JSON.stringify(walk.return(9)), JSON.stringify(walk.next()));
})();
(function theBodyThrowsAtItsFirstStep() {
  try {
    function* takes(a) { fail("first step"); yield a; }
    const walk = takes(1);
    note("made");
    walk.next();
    note("stepped");
  } catch (error) { note("THROWS", error.constructor.name, error.message); }
})();
