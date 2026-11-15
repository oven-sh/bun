// COUNTER: operationAOTConcatenatePair <= 60000
function suffix(of: { alias?: string }): string { return of.alias ? "@" + of.alias : ""; }
function run(ids: number, rounds: number): number {
  const seen = new Map<string, number>();
  const plain = {};
  let found = 0;
  for (let round = 0; round < rounds; round++) {
    for (let id = 100; id < 100 + ids; id++) {
      const key = id + suffix(plain);
      const known = seen.get(key);
      if (known !== undefined) found += known;
      else seen.set(key, 1);
    }
  }
  return found;
}
console.log(run(40000, 3));
