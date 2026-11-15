class Anchor { weigh() { return 1; } }
class Barrel { weigh() { return 2; } }
class Candle { weigh() { return 3; } }
function pick<T extends Anchor | Barrel | null>(value: T, flag: boolean) {
  let held;
  held = value;
  let sum = 0;
  if (flag && held !== null) sum += held.weigh();
  const kept = held;
  if (!flag) held = new Candle();
  if (held !== null) sum += held.weigh();
  const last = held;
  return [sum, kept === value, last === value] as const;
}
console.log(pick(new Anchor(), true).join(" "), pick(new Barrel(), false).join(" "), pick(null, true).join(" "), pick(null, false).join(" "));
