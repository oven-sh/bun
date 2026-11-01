// Map.get, Map.has and Set.has with the same arguments in every iteration. The lookup may leave the loop only where nothing in the loop can change the collection.
const unknown = new Function("f", "return f") as <F>(f: F) => F;
const map = new Map<string, number>([["a", 1], ["b", 2]]);
const set = new Set<string>(["a"]);
const key = ["a"].join("");

function unchanged(n: number) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += (map.get(key) ?? 0) + (map.has(key) ? 10 : 0) + (set.has(key) ? 100 : 0);
  return sum;
}
function storedInLoop(n: number) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += map.get(key) ?? 0;
    map.set(key, i);
  }
  return sum;
}
function deletedInLoop(n: number) {
  let seen = "";
  for (let i = 0; i < n; i++) {
    seen += map.has(key) ? "y" : "n";
    if (i === 1) map.delete(key);
    if (i === 3) map.set(key, 7);
  }
  return seen;
}
function clearedThroughAlias(n: number, alias: Set<string>) {
  let seen = "";
  for (let i = 0; i < n; i++) {
    seen += set.has(key) ? "y" : "n";
    if (i === 2) alias.clear();
  }
  return seen;
}
const change = unknown((i: number) => { if (i === 1) map.set(key, 50); });
function changedByUnknownCode(n: number) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += map.get(key) ?? 0;
    change(i);
  }
  return sum;
}
function otherMapStored(n: number, other: Map<string, number>) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += map.get(key) ?? 0;
    other.set("x" + i, i);
  }
  return sum + other.size;
}
function neverEntered(n: number, absent: Map<string, number> | null) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += absent!.get(key) ?? 0;
  return sum;
}
function keyChanges(n: number) {
  let sum = 0, name = "a";
  for (let i = 0; i < n; i++) {
    sum += map.get(name) ?? 0;
    name = name === "a" ? "b" : "a";
  }
  return sum;
}
function objectsStayTheSame(n: number) {
  const held = new Map<string, object>([["a", {}]]);
  const first = held.get(key);
  let same = true;
  for (let i = 0; i < n; i++) same &&= held.get(key) === first;
  return same;
}
console.log("unchanged", unchanged(5), unchanged(0));
console.log("stored in the loop", storedInLoop(5), map.get("a"));
console.log("deleted in the loop", deletedInLoop(6));
console.log("cleared through an alias", clearedThroughAlias(5, set));
console.log("changed by unknown code", changedByUnknownCode(4));
console.log("another map is stored to", otherMapStored(3, new Map()), otherMapStored(3, map));
console.log("never entered", neverEntered(0, null));
console.log("the key changes", keyChanges(5));
console.log("objects stay the same", objectsStayTheSame(4));
