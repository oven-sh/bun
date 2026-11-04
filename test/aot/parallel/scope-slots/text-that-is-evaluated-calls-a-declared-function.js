// The text calls a function of the scope, which reads in front of the store.
function make(base) {
  const early = eval("read()");
  const limit = base + 3;
  return [early, read()].join();
  function read() { try { return limit; } catch (e) { return e.name; } }
}
for (let round = 0; round < 3; round++) console.log(make(round));
