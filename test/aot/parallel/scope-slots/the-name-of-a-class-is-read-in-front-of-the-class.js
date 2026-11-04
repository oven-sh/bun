// The name of a class has a dead zone too.
function make() {
  const get = () => Made;
  let early;
  try { early = get().name; } catch (e) { early = e.name; }
  class Made {}
  return [early, get().name].join();
}
for (let round = 0; round < 3; round++) console.log(make());
