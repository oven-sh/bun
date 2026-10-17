// Code without types reads fields whose functions have not been made, of one fresh object after another.
export function readOne(object, key) {
  let called = 0, missing = 0, wrong = 0;
  const byKey = object[key];
  if (typeof byKey === "function") called += byKey(1); else missing++;
  const byName = object.twice;
  if (typeof byName === "function") called += byName(2); else missing++;
  if (!(key in object) || !Object.hasOwn(object, "add") || !object.hasOwnProperty(key)) wrong++;
  if (object[key] !== byKey || object.twice !== byName) wrong++;
  if (object.never !== undefined) wrong++;
  return called * 10000 + missing * 100 + wrong;
}
export function callOne(object, i) { return object.add(i & 3) + object["thrice"](1); }
export function hasOne(object, key) { return (key in object ? 1 : 0) + (Object.hasOwn(object, key) ? 2 : 0) + (object.propertyIsEnumerable(key) ? 4 : 0); }
export function listOne(object) { return Object.keys(object).join() + "|" + Object.values(object).map(value => typeof value).join() + "|" + JSON.stringify(object); }
export function copyOne(object) {
  const copy = { ...object }, assigned = Object.assign({}, object), { add, ...rest } = object;
  return (copy.add === object.add ? 1 : 0) + (assigned.twice === object.twice ? 2 : 0) + (add === object.add ? 4 : 0) + (rest.thrice === object.thrice ? 8 : 0) + copy.thrice(1) * 16;
}
