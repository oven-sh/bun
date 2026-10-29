// A generator with a pattern for a parameter reads its argument when it is made, not at its first step.
function* takes({ size }) {
  yield size;
  yield size + 1;
}
function run(turn) {
  const said = [];
  const given = {
    get size() {
      said.push("read");
      return turn;
    },
  };
  const steps = takes(given);
  said.push("made");
  said.push(steps.next().value);
  return said.join();
}
for (let turn = 0; turn < 4; turn++) console.log(run(turn));
