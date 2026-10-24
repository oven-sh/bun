// `const built: T = Object.assign(base, definition)`: a typed object assembled from a definition that is one of a few literals.
type Tool = { name: string; cost: number; run(x: number): number; enabled: boolean };
type Definition = { name: string; cost: number; run(x: number): number };
function build(definition: Definition): Tool {
  const built: Tool = Object.assign({ enabled: true }, definition);
  return built;
}
const tools = [
  build({ name: "double", cost: 1, run: x => x * 2 }),
  build({ name: "square", cost: 2, run: x => x * x }),
  build({ name: "negate", cost: 3, run: x => -x }),
];
let total = 0;
for (let i = 0; i < 3000000; i++) {
  const tool = tools[i % 3];
  if (tool.enabled) total += tool.run(i & 15) + tool.cost + tool.name.length;
}
console.log(total, tools.map(tool => Object.keys(tool).join()).join(" "));
