// calls a function that lies far out of line in objects with hundreds of functions
const operations = 100;
function toolsOf(seed: number): any {
  const tools: Record<string, (x: number) => number> = {};
  for (let i = 0; i < 300; i++) tools["f" + i] = x => (x < 0 ? process.argv.length : x + seed + i);
  return tools;
}
const tools = [toolsOf(1), toolsOf(2), toolsOf(3), toolsOf(4)];
let total = 0;

kernel: {
  let sum = 0;
  for (let i = 0; i < operations; i++) sum += tools[i & 3].f250(i);
  total += sum;
}

console.log(total);
