// A walk stands in a table of tens of thousands of entries, which has memory of its own, entries are deleted in front of it and behind it, and then the table is replaced: it grows, one number widens its keys, or it is cleared. The walk goes on where it stood.
const unseen = <T>(x: T): T => [x][JSON.parse("0")];
const count = unseen(30000), stands = unseen(12000);

function mix(sum: number, text: string): number {
  for (let i = 0; i < text.length; i++) sum = (Math.imul(sum, 31) + text.charCodeAt(i)) | 0;
  return sum;
}

function filledSet(): Set<string | number> {
  const set = new Set<string | number>();
  for (let i = 0; i < count; i++) set.add("k" + i);
  return set;
}

function filledMap(): Map<string | number, number> {
  const map = new Map<string | number, number>();
  for (let i = 0; i < count; i++) map.set("k" + i, i);
  return map;
}

// Every third key of the first and of the last 6,000: 2,000 in front of the walk, 2,000 behind it. Their list is longer than a page.
function thin(collection: Set<string | number> | Map<string | number, number>): void {
  for (let i = 0; i < 6000; i += 3) {
    collection.delete("k" + i);
    collection.delete("k" + (count - 1 - i));
  }
}

function rest(label: string, walk: Iterator<string | number>): void {
  let seen = 0, sum = 0, first = "", last = "";
  for (let step = walk.next(); !step.done; step = walk.next()) {
    const text = String(step.value);
    if (!seen) first = text;
    last = text;
    sum = mix(sum, text);
    seen++;
  }
  console.log(label, seen, first, last, sum);
}

function standingIn(collection: Set<string | number> | Map<string | number, number>): Iterator<string | number> {
  const walk = collection.keys();
  for (let i = 0; i < stands; i++) walk.next();
  return walk;
}

{
  const set = filledSet(), walk = standingIn(set);
  thin(set);
  for (let i = 0; i < count * 3; i++) set.add("more" + i);
  rest("a Set grows twice", walk);
}
{
  const set = filledSet(), walk = standingIn(set);
  thin(set);
  set.add(0.5);
  rest("one number widens a Set", walk);
}
{
  const set = filledSet(), walk = standingIn(set), untouched = set.values();
  thin(set);
  set.add(0.5);
  for (let i = 0; i < count * 2; i++) set.add("more" + i);
  set.delete("more7");
  rest("widened, then grown", walk);
  rest("a walk that had taken nothing", untouched);
}
{
  const set = filledSet(), walk = standingIn(set);
  thin(set);
  set.add(0.5);
  // 3,000 more in front of the walk and 3,000 more behind it go from the second table. That is replaced too, and the collector makes one list of the two in the first table: it is longer than the list that the first table had.
  for (let i = 1; i < 9000; i += 3) {
    set.delete("k" + i);
    set.delete("k" + (count - 1 - i));
  }
  for (let i = 0; i < count * 2; i++) set.add("more" + i);
  Bun.gc(true);
  rest("entries go between two replacements, then a collection", walk);
}
{
  const set = filledSet(), walk = standingIn(set);
  thin(set);
  set.clear();
  for (let i = 0; i < 5; i++) set.add("fresh" + i);
  rest("a Set is cleared", walk);
}
{
  const map = filledMap(), walk = standingIn(map);
  thin(map);
  for (let i = 0; i < count * 3; i++) map.set("more" + i, i);
  rest("a Map grows twice", walk);
}
{
  const map = filledMap(), walk = standingIn(map);
  thin(map);
  map.set(0.5, -1);
  map.set("k" + (stands + 5), 0.25);
  rest("one number widens a Map", walk);
  console.log("values", map.get(0.5), map.get("k" + (stands + 5)), map.get("k" + (stands + 6)), map.size);
}
{
  const set = filledSet();
  let seen = 0, sum = 0;
  for (const key of set) {
    if (seen === stands) {
      thin(set);
      for (let i = 0; i < count * 2; i++) set.add("more" + i);
    }
    if (seen === stands + 100) set.add(0.5);
    sum = mix(sum, String(key));
    seen++;
  }
  console.log("a loop replaces the table it walks", seen, sum, set.size);
}
{
  const map = filledMap();
  let seen = 0, sum = 0;
  map.forEach((value, key) => {
    if (seen === stands) {
      thin(map);
      for (let i = 0; i < count * 2; i++) map.set("more" + i, i);
    }
    sum = mix(sum, String(key)) ^ value;
    seen++;
  });
  console.log("forEach replaces the table it walks", seen, sum, map.size);
}
