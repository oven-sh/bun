// COUNTER: operationAOTConcatenatePair <= 200
function suffix(of: { alias?: string }): string { return of.alias ? "@" + of.alias : ""; }
function run(count: number): number {
  const seen = new Map<string, number>();
  const plain = {};
  const names: string[] = [];
  for (let i = 0; i < count; i++) names.push("name-" + (i % 5000) + "-of-a-type");
  let found = 0;
  for (let i = 0; i < count; i++) {
    const key = names[i] + suffix(plain);
    found += seen.get(key) ?? 0;
    seen.set(key, i & 3);
  }
  return found;
}
console.log(run(30000));
