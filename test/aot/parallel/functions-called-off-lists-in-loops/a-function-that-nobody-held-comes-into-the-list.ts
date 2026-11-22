// STATISTIC: CallsDispatchedByCallee >= 1
const steps: any[] = [(x: number) => x + 1, (x: number) => x * 2];
function run(): string {
  let out = "";
  for (let i = 0; i < steps.length; i++) out += steps[i](i + 3) + ";";
  return out;
}
const said = [run()];
const lay = new Function(
  "list",
  "list.push(x => x + 100, Math.abs, String, function* (x) { yield x; }, JSON.parse.bind(JSON)); list[0] = x => -x;",
);
lay(steps);
said.push(run());
console.log(said.join("\n"));
