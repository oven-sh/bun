// The closure lies in a slot of the scope that it closes over, and the body calls what it reads out of the slot.
function make(base) {
  let read = () => { try { return late; } catch (e) { return e.name; } };
  const keep = () => read;
  const early = read();
  const late = base + 1;
  if (base > 100) read = () => 0;
  return [early, read(), keep() === read].join();
}
for (let round = 0; round < 3; round++) console.log(make(round));
