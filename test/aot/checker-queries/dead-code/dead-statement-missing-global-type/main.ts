declare const live: boolean;
function kept() {
  if (false) {
    class Unused { async *each() { yield 1; } }
    for (const one of [async function* () { yield 2; }]) one();
    const { made = async function* () { yield 3; } } = {} as { made?: () => unknown };
    const table = { async *each() { yield 4; } };
    async function* declared() { yield 5; }
    new Unused().each(), made(), table.each(), declared();
  }
  return live ? 1 : 2;
}
while (false) { (async function* () { yield 6; })(); }
if (false) {
  const numbers = async function* () { yield 7; };
  numbers();
}
export const answer = kept();
