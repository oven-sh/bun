// Direct eval names whatever is in scope.
function make() {
  let early;
  try { early = eval("limit"); } catch (e) { early = e.name; }
  const limit = 3;
  const keep = () => limit;
  return [early, eval("limit"), keep()].join();
}
function plain() {
  const early = String(eval("count"));
  var count = 4;
  const keep = () => count;
  return [early, keep()].join();
}
for (let round = 0; round < 3; round++) console.log(make(), plain());
