// COUNTER: operationAOTConcatenatePair <= 400
function suffix(of: { alias?: string }): string { return of.alias ? "@" + of.alias : ""; }
function run(rounds: number): number {
  const seen = new Map<string, number>();
  const plain = {};
  let found = 0;
  for (let round = 0; round < rounds; round++) {
    for (let id = -1; id > -101; id--) {
      const key = id + suffix(plain);
      found += seen.get(key) ?? 0;
      seen.set(key, -id);
    }
  }
  return found;
}
console.log(run(300));
