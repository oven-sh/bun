// A text joined from constants is known when the program is built, and still throws where one of the constants is read in its dead zone.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const early = () => `${family}/early`;
const earlySum = () => family + "/early";
const earlyNumber = () => size * 2 + 1;
console.log(attempt(early), attempt(earlySum), attempt(earlyNumber));
const family = "~library/Step";
const size = 20;
const held = `${family}/held`;
const summed = family + "/summed";
const nested = `${held}:${summed}:${size + 1}`;
console.log(attempt(early), attempt(earlySum), attempt(earlyNumber), held, summed, nested);
const shared = { [held]: 1, [summed]: 2, [nested]: 3 };
const made = Object.create(shared);
made[held] = 4;
console.log(Object.keys(made), Object.keys(shared), made[held], made[summed], made[nested], held in made, `${family}/held` in made, family + "/absent" in made);
function inBlock(flag) {
  if (flag) return attempt(() => `${later}!`);
  const value = attempt(() => `${later}?`);
  const later = "later";
  return value + `${later}.`;
}
console.log(inBlock(true), inBlock(false));
for (let turn = 0; turn < 2; turn++) {
  const before = attempt(() => `${each}-${turn}`);
  const each = "each";
  console.log(before, `${each}-${turn}`, `${each}-x`);
}
switch (size) {
  case 20:
    console.log(attempt(() => `${inCase}!`));
  case 21:
    const inCase = "case";
    console.log(`${inCase}!`);
}
