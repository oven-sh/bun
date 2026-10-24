// Two records compared key by key, as a renderer compares styles: for-in over one, reads by the key in both.
type Style = { [key: string]: string | number | boolean | undefined };
function diff(before: Style | undefined, after: Style | undefined): Style | undefined {
  if (before === after) return undefined;
  if (!before) return after;
  const changed: Style = {};
  let isChanged = false;
  for (const key of Object.keys(before)) { const isDeleted = after ? !Object.hasOwn(after, key) : true; if (isDeleted) { changed[key] = undefined; isChanged = true; } }
  if (after) for (const key of Object.keys(after)) { if (after[key] !== before[key]) { changed[key] = after[key]; isChanged = true; } }
  return isChanged ? changed : undefined;
}
const rounds = Number(process.argv[2] ?? 0);
let n = 0;
const a = { flexDirection: "row", flexGrow: 1, width: 80, paddingLeft: 1, marginTop: 0, color: "red" };
const b = { flexDirection: "row", flexGrow: 1, width: 80, paddingLeft: 1, marginTop: 0, color: "red" };
const c = { flexDirection: "column", flexGrow: 0, width: 81, paddingLeft: 1, marginTop: 0, color: "red" };
for (let r = 0; r < rounds; r++) { if (diff(a, b)) n++; if (r % 16 === 0 && diff(a, c)) n++; }
console.log(n);
