interface Settings {
  alpha: number;
  beta: number;
  gamma: number;
  delta?: number;
}
function build(late: { alpha: number }): Settings {
  return Object.assign({ gamma: 3 }, { beta: 2 }, late) as unknown as Settings;
}
const settings = build({ alpha: 1 });
console.log(Object.keys(settings).join(), JSON.stringify(settings));
const seen: string[] = [];
for (const key in settings) seen.push(key);
console.log(seen.join(), Object.entries(settings).join("|"));
settings.delta = 4;
delete (settings as { beta?: number }).beta;
settings.beta = 5;
console.log(Object.keys(settings).join(), JSON.stringify({ ...settings }), settings.alpha + settings.beta + settings.gamma);
