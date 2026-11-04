// A closure over the scope goes to a callee that calls it at once.
function callNow(f) { try { return f(); } catch (e) { return e.name; } }
function make() {
  const early = callNow(() => limit);
  const limit = 10;
  return [early, callNow(() => limit)].join();
}
for (let round = 0; round < 3; round++) console.log(make());
