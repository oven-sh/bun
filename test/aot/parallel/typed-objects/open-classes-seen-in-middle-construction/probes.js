export function probe(seen) {
  const names = [];
  for (const name in seen) names.push(name);
  return [Object.keys(seen).join(), names.length, "h" in seen, Object.hasOwn(seen, "h"), typeof seen.f, JSON.stringify(seen), Object.keys({ ...seen }).length, Object.getOwnPropertyNames(seen).length].join("|");
}
export const kept = [];
export function keep(seen) {
  kept.push(seen);
  return kept.length;
}
export function fail(why) {
  if (why) throw new Error(why);
  return 0;
}
