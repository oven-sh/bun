import { generate as manyLiveValues } from "./many-live-values";
import type { Random } from "./random";

const quietTick = /function tick\(\): void \{\n  if \(\+\+calls % 977 === 0\)\n    try \{\n      throw calls;\n    \} catch \{\}\n\}/;
const blowingTick = `let fuse = 0;
class Blown extends Error {}
function tick(): void {
  calls++;
  if (fuse > 0 && --fuse === 0) throw new Blown("blown");
}`;
const rounds = /^  for \(let i = 0; i < \d+; i\+\+\) hash = \(Math\.imul\(hash, 31\) \+ (.*)\) \| 0;$/gm;

export function generate(random: Random): string {
  const text = manyLiveValues(random);
  if (!quietTick.test(text)) return text;
  return text.replace(quietTick, blowingTick).replace(
    rounds,
    (whole, answer) => `${whole}
  for (let at = 1; at <= 600; at++) {
    const i = at & 15;
    fuse = at;
    try {
      hash = (Math.imul(hash, 31) + ${answer}) | 0;
    } catch (error) {
      hash = (Math.imul(hash, 31) + (error instanceof Blown ? 7 : 11)) | 0;
    }
    if (fuse > 0) break;
  }
  fuse = 0;`,
  );
}
