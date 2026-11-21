// The declared effects of the in operator include closures made at first read.
// Under: --aot-testing=CheckEffectsAtRunTime: the declared effects include closures made at first read
const numberFrom = value => Number(globalThis.nothingOfThisName ?? value);
const textFrom = value => String(globalThis.nothingOfThisName ?? value);
function ask(start, name) {
  let count = start;
  const made = { open: () => ++count, shut: () => --count, ajar: () => count };
  const answer = name in made;
  return answer + "," + (made.open === made.open) + "," + made.open();
}
for (let start = 1; start <= numberFrom(64); start++) console.log(ask(start, textFrom("open")));
