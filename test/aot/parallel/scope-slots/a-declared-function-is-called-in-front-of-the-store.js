// The body itself calls a function that was declared beside the binding, in front of the store.
function make(base) {
  const early = read();
  const limit = base + 10;
  return [early, read()].join();
  function read() { try { return limit; } catch (e) { return e.name; } }
}
for (let round = 0; round < 3; round++) console.log(make(round));
