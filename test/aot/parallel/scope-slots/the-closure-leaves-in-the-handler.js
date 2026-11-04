// What throws does so in front of the store, and the handler lets the closure go.
function tryCall(f) { try { return f(); } catch (e) { return e.name; } }
function make(thrower) {
  const read = () => held;
  try { thrower(); } catch (e) { return "caught " + tryCall(read); }
  const held = 1;
  return "through " + tryCall(read);
}
for (let round = 0; round < 3; round++) console.log(make(() => { throw 0; }), make(() => 0));
