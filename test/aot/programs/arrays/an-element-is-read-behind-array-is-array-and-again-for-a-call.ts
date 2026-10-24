// Array.isArray(x) && typeof x[0] === "string" && f(x[0]): the element is read again as the argument of a call that the function is cut at.
const cache = new Map<string, readonly string[]>();
function parts(key: string): readonly string[] {
  let found = cache.get(key);
  if (found === undefined) { found = Object.freeze(key.split(".")); if (cache.size >= 32768) cache.clear(); cache.set(key, found); }
  return found;
}
function startsWithWord(x: unknown): boolean {
  return Array.isArray(x) && typeof x[0] === "string" && parts(x[0]).length > 1;
}
const inputs = JSON.parse("[[\"a.b\"],[1],[null],{},[\"c\"]]");
for (const input of inputs) console.log(startsWithWord(input));
