function join(a, b) { return (a + b) | 0; }
function part(a, b) { return (a - b) | 0; }
const name = ["jo", "in"].join("");
function run(which) {
  const tools = {};
  Object.defineProperty(tools, "join", { value: join, configurable: true });
  let sum = 0;
  for (let turn = 0; turn < 200; turn++) {
    if (turn === 100) { if (which === 0) Object.defineProperty(tools, name, { get: () => part, configurable: true }); else if (which === 1) Object.defineProperty(tools, name, { value: part }); else Object.defineProperty(tools, name, { get: function () { return join; }, set(value) {}, configurable: true }); }
    for (let i = 0; i < 20; i++) sum = (sum + tools.join(i, turn)) | 0;
  }
  return sum;
}
console.log(run(0), run(1), run(2));
