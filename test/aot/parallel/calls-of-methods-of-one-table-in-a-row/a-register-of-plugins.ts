interface Plugin { name: string; run: () => number; stop: () => number }
function plugin(name: string): Plugin {
  let count = 0;
  return { name, run: () => ++count, stop: () => (count = 0) };
}
const extra: Record<string, unknown> = {};
function extend(target: any, from: Record<string, unknown>): void { for (const key of Object.keys(from)) target[key] = from[key]; }
function register(commands: Map<unknown, unknown>, plugins: Plugin[]): void {
  for (const one of plugins) {
    if (commands.has(one.name)) continue;
    commands.set(one.name, one.run);
    commands.set(one.run, one.stop);
  }
}
for (let k = 0; k < 9; k++) {
  const commands = new Map<unknown, unknown>();
  extend(commands, extra);
  const plugins: any[] = [plugin("a" + k), plugin("b" + k)];
  if (k > 6) plugins.push(new Date(k));
  register(commands, plugins);
  console.log("SAID", k, commands.size);
}
