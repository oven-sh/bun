// A variable stored once is read in a loop, and the store runs during the loop: the read must not move above the store.
function use(value: number): number {
  return value + 1;
}

let total = 0;
for (let round = 0; round < 3; round++) {
  const lazy = require("./lazy");
  total += use(lazy.value) + lazy.sum(round + 1);
}
console.log(total);

let state: number | undefined;
function initialize(): void {
  state = 7;
}
function readAfterInitializer(): number | undefined {
  initialize();
  return state;
}
console.log(readAfterInitializer());

let later: number | undefined;
function initializeLater(): void {
  later = 9;
}
function readAcrossInitializer(): unknown[] {
  const reads: unknown[] = [];
  for (let round = 0; round < 4; round++) {
    if (round === 2) initializeLater();
    reads.push(later);
  }
  return reads;
}
console.log(JSON.stringify(readAcrossInitializer().map(read => read ?? null)));
