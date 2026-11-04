// A builder that reads a member of the definition, of a declared type that nobody has proven, in front of the copy of the descriptors: the code behind the test of that type exists twice.
type Definition = { name: string; cost: number; allowed?: (x: number) => boolean; readonly label: string; run(x: number): number };
type Built = Definition & { enabled(): boolean; title(): string; admits(x: number): boolean };
const DEFAULTS = { enabled: () => true, cost: 1 };
function build(def: Definition): Built {
  const allowed = def.allowed;
  const facing = { admits: (x: number) => (allowed ? allowed(x) : true) };
  const built: Built = Object.assign(
    Object.defineProperties({ ...DEFAULTS, title: () => def.name }, Object.getOwnPropertyDescriptors(def)),
    facing,
  ) as unknown as Built;
  return built;
}
const parsed = JSON.parse('{"name":"parsed","cost":5,"allowed":7,"label":"plain"}');
parsed.run = (x: number) => x + 1;
const tools = [
  build({ name: "double", cost: 2, get label() { return this.name.toUpperCase(); }, run: x => x * 2 }),
  build({ name: "square", cost: 3, allowed: x => x > 1, get label() { return "[" + this.name + "]"; }, run: x => x * x }),
  build(parsed),
];
for (const tool of tools) {
  let admits: unknown;
  try { admits = tool.admits(2); } catch (e) { admits = (e as Error).name; }
  console.log(tool.name, tool.cost, tool.label, tool.run(3), tool.title(), tool.enabled(), admits, Object.keys(tool).join(), typeof Object.getOwnPropertyDescriptor(tool, "label")!.get);
}
