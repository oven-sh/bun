// Three pairs that may fail to be made hold one another and leave on one way.
function make(first, fails, leaves) {
  function Pair(head, fails, ...rest) {
    if (fails) throw new Error("no pair");
    try {
      this.rest = rest;
    } catch (e) {}
    try {
      this.head = head;
    } catch (e) {}
  }
  let inner;
  try {
    inner = new Pair(first, fails & 1, 1);
  } catch (e) {}
  let middle;
  try {
    middle = new Pair(inner, fails & 2, 2);
  } catch (e) {}
  let outer;
  try {
    outer = new Pair(middle, fails & 4, 3);
  } catch (e) {}
  if (leaves) return { value: outer };
}

for (let turn = 0; turn < 16; turn++) {
  const made = make(turn, turn >> 1, turn % 2 === 1);
  console.log(turn, made ? JSON.stringify(made) : "nothing");
}
