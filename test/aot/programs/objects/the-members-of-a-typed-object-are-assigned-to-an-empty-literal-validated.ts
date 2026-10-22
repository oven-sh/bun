// The names that Object.assign copies onto `{}` are those of the source's type, so the literal's layout gets its fields from the copy. The build checks itself while it runs:
// it stops where the object that the literal makes is not what the types of `copy` and of what is read from it say.
interface Pair { label: string; count: number }
function pair(label: string): Pair { return { label, count: label.length }; }
function copyUnder(key: string, source: Pair) {
  const byKey: any = Object.assign({}, source);
  byKey[key] = source.count + 1;
  return byKey;
}
const assigned = pair("r");
const copy = Object.assign({}, assigned);
console.log(copy.label, copy.count, Object.keys(copy).join());
const twice = Object.assign({}, assigned, { more: true });
console.log(twice.label, twice.count, twice.more, Object.keys(twice).join());
console.log(JSON.stringify(copyUnder("k" + copy.count, assigned)), JSON.stringify(copyUnder("label", pair("long"))));
console.log(JSON.stringify(Object.assign({}, {})), Object.keys(Object.assign({}, null, undefined, "ab")).join());
