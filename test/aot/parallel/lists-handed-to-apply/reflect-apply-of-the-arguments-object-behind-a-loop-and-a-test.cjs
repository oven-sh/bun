// The arguments object is named in front of a loop and a test and handed on behind them; a proxy's handler shows what the rare road hands.
// STATISTIC: CallsForwardedBehindTestsOfTheirTargets >= 1
const join = (one, two, three) => one + two + three;
const shown = new Proxy(join, { apply(target, self, list) { return "shown:" + list.length + ":" + list.join("|"); } });
const data = JSON.parse('{"turns":3}');
function pick(target, turns) {
  const all = arguments;
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += i;
  if (sum > 1) return Reflect.apply(target, null, all);
  return "none";
}
globalThis.handed = [pick];
for (const target of [join, shown]) console.log(String(pick(target, data.turns, "z")).replace(/\(.*/s, "(..)"), pick(target, 1, "z"));
