// The closure that reads is reached only through a slot of the scope itself.
function make(base) {
  const early = first();
  const held = base + 1;
  return [early, first()].join();
  function first() { return second(); }
  function second() { try { return held; } catch (e) { return e.name; } }
}
for (let round = 0; round < 3; round++) console.log(make(round));
