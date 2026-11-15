import vm from "node:vm";
const written = ["alpha", "gamma", "delta", "omega", "kappa", "☃lphé"];
const same = (left: unknown, right: unknown) => left === right;
const context = vm.createContext({ written, same, names: { alpha: 1, gamma: 2 } });
function rows(texts: string[]): string {
  return texts.map(text => [written.filter(other => same(other, text)).length, written.indexOf(text), written.lastIndexOf(text), written.includes(text), text == written[1]].join(",")).join(" ");
}
for (let turn = 0; turn < 3; turn++) {
  const inside = vm.runInContext("['alpha', 'gamma', 'delta', 'omeg' + 'a', `kappa`, '\\u2603lph\\u00e9', ...Object.keys(names), ...written]", context) as string[];
  console.log(rows(Array.from(inside)), vm.runInContext("[same('alpha', written[0]), written.indexOf('delta'), written.includes('omega'), written.indexOf('sigma')].join()", context));
  console.log(rows(new Function("return ['alpha', 'delta', 'sigma', 'kap' + 'pa']")() as string[]), rows((0, eval)("['gamma', 'omega', 'theta']") as string[]));
  console.log(rows(["alpha gamma delta omega kappa".split(" "), JSON.parse('["alpha","\\u2603lph\\u00e9"]'), Object.keys({ alpha: 1, kappa: 2 })].flat()));
}
