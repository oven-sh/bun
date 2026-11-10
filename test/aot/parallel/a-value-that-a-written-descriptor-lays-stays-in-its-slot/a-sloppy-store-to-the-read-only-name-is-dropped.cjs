function double(n) { return (n * 2) | 0; }
function triple(n) { return (n * 3) | 0; }
const tools = {};
Object.defineProperty(tools, "scale", { value: double });
function use(turn) { let sum = 0; for (let i = 0; i < 50; i++) sum = (sum + tools.scale(i + turn)) | 0; return sum; }
function put(holder, value) { holder.scale = value; return holder.scale === value; }
let said = 0, taken = 0;
for (let turn = 0; turn < 400; turn++) {
  if (turn % 100 === 99 && put(tools, triple)) taken++;
  said = (said + use(turn)) % 1000003;
}
console.log(said, taken, tools.scale === double);
