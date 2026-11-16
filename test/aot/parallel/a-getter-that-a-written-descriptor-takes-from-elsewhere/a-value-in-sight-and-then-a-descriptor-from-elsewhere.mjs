function join(a, b) { return (a + b) | 0; }
function part(a, b) { return (a - b) | 0; }
function pick(which) { return [{ get: () => part, configurable: true }, { value: part }, { get: function () { return join; }, set(value) {}, configurable: true }][which]; }
function run(which) {
  const tools = {};
  Object.defineProperty(tools, "join", { value: join, configurable: true });
  let sum = 0;
  for (let turn = 0; turn < 200; turn++) { if (turn === 100) Object.defineProperty(tools, "join", pick(which)); for (let i = 0; i < 20; i++) sum = (sum + tools.join(i, turn)) | 0; }
  return sum + ":" + Object.keys(Object.getOwnPropertyDescriptor(tools, "join")).join();
}
console.log(run(0), run(1), run(2));
