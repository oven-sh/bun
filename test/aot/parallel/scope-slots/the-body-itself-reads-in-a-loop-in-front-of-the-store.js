// The body's own read stands in a loop, where nothing is known of the slot but its type.
function make(turns, base) {
  let early = "none";
  for (let i = 0; i < turns; i++) {
    try { early = limit; } catch (e) { early = e.name; }
  }
  const limit = base + 1;
  const later = () => limit;
  return [early, later()].join();
}
function plain(turns, base) {
  let early = "none";
  for (let i = 0; i < turns; i++) early = String(count);
  var count = base + 1;
  const later = () => count;
  return [early, later()].join();
}
for (let round = 0; round < 3; round++) console.log(make(round, round), plain(round, round));
