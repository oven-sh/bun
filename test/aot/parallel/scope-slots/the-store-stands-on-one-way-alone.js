// The store stands in front of the point at which the closure leaves in the text, and on one way only.
function make(stores) {
  if (stores) { var held = 1; }
  return () => held;
}
function dead(stores) {
  const read = () => { try { return late; } catch (e) { return e.name; } };
  if (!stores) return read();
  const late = 2;
  return read();
}
for (let round = 0; round < 3; round++) console.log(String(make(false)()), make(true)(), dead(false), dead(true));
