// Objects filled under tries hold one another and leave on one way.
function make(first, leaves) {
  function Pair(head, ...rest) {
    try {
      this.rest = rest;
    } catch (e) {}
    try {
      this.head = head;
    } catch (e) {}
  }
  let inner;
  try {
    inner = new Pair(first, 1);
  } catch (e) {}
  let outer;
  try {
    outer = new Pair(inner, 2);
  } catch (e) {}
  function read() {
    return outer;
  }
  if (leaves) return { read };
}

for (let turn = 0; turn < 4; turn++) {
  const made = make(turn, turn % 2 === 1);
  console.log(turn, made ? JSON.stringify(made.read()) : "nothing");
}
