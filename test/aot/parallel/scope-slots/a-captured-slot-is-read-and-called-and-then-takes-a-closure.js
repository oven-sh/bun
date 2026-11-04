// As a-slot-is-read-and-called-and-then-takes-a-closure.js, with the binding in the scope: another closure names it.
function make(base) {
  let step = () => "first";
  const keep = () => step;
  const out = [];
  for (let i = 0; i < 3; i++) {
    out.push(step());
    step = () => { try { return late; } catch (e) { return e.name; } };
  }
  const late = "late" + base;
  out.push(step(), keep() === step);
  return out.join();
}
for (let round = 0; round < 3; round++) console.log(make(round));
