// The read stands in front of the store of the closure in the text and behind it in the next turn.
function make() {
  var step = () => "first";
  const out = [];
  for (let i = 0; i < 3; i++) {
    out.push(step());
    step = () => { try { return late; } catch (e) { return e.name; } };
  }
  const late = "late";
  out.push(step());
  return out.join();
}
for (let round = 0; round < 3; round++) console.log(make());
