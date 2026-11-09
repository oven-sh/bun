// The text is asked for, evaluated and called three hundred times, by code in sight and out of sight.
namespace Meter { export let total = 0; export function add(more: number) { enum Step { One = 1, Ten = 10 } total += more * Step.Ten + Step[1].length; return total; } }
const ask: (made: Function) => string = (0, eval)("(made) => Function.prototype.toString.call(made)");
const other = { total: 0 };
for (let round = 0; round < 300; round++) {
  const text = round % 2 ? String(Meter.add) : ask(Meter.add);
  (0, eval)("(function (Meter) { return (" + text + "); })")(other)(round);
  Meter.add(round);
}
console.log(other.total, Meter.total);
