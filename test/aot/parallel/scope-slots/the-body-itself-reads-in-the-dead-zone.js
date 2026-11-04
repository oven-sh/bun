// The body that makes the scope reads the captured binding in front of its store.
function make() {
  let early;
  try { early = limit; } catch (e) { early = e.name; }
  const limit = 1;
  const later = () => limit;
  return [early, later()].join();
}
for (let round = 0; round < 3; round++) console.log(make());
