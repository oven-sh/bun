// One builder that many callers hand a literal of their own: defaults are spread, the descriptors of the definition are copied (definitions carry getters), a literal of methods is assigned on top.
type Definition = { name: string; cost: number; readonly label: string; run(x: number): number };
type Built = Definition & { enabled(): boolean; title(): string; describe(): string; twice(x: number): number };
const DEFAULTS = { enabled: () => true, cost: 1 };
function build(def: Definition): Built {
  const facing = {
    describe: () => def.name + ":" + def.cost,
    twice: (x: number) => def.run(def.run(x)),
  };
  const built: Built = Object.assign(
    Object.defineProperties({ ...DEFAULTS, title: () => def.name }, Object.getOwnPropertyDescriptors(def)),
    facing,
  ) as unknown as Built;
  return built;
}
const double = build({ name: "double", cost: 2, get label() { return this.name.toUpperCase(); }, run: x => x * 2 });
const square = build({ name: "square", cost: 3, get label() { return "[" + this.name + "]"; }, run: x => x * x });
const negate = build({ name: "negate", cost: 4, get label() { return this.name; }, run: x => -x });
const tools = [double, square, negate];
let total = 0;
for (let i = 0; i < 2000000; i++) {
  const tool = tools[i % 3];
  if (tool.enabled()) total += tool.run(i & 7) + tool.twice(i & 3) + tool.cost + tool.title().length;
}
console.log(total, tools.map(tool => tool.label + " " + tool.describe() + " " + Object.keys(tool).join()).join(" | "));
