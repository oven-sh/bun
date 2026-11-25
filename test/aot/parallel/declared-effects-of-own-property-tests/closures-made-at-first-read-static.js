// The declared effects of Object.hasOwn include closures made at first read.
// Under: --aot-testing=CheckEffectsAtRunTime: the declared effects include closures made at first read
const numberFrom = value => Number(globalThis.nothingOfThisName ?? value);
const textFrom = value => String(globalThis.nothingOfThisName ?? value);
function ask(start, name) {
  let count = start;
  const made = { open: () => ++count, shut: () => --count, ajar: () => count };
  const answer = Object.hasOwn(made, name);
  return answer + "," + (made.open === made.open) + "," + made.open();
}
for (let start = 1; start <= numberFrom(64); start++) console.log(ask(start, textFrom("open")));
