// captures a variable of a function
function start(bias) {
  class Held {
    set(value) { return value + bias++; }
  }
  const said = [];
  for (let i = 0; i < 5; i++) {
    const held = new Held();
    globalThis.kept = held;
    said.push(held.set(i));
  }
  return said.join(" | ");
}
console.log(start(7));
