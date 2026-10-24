// A list of keys is made anew in each round of a loop. What an earlier round did with its list (handed it to a Set, kept it) says nothing about the list of this round, whose tests hold across calls of unknown code; a list that is changed in its own round is read as changed.
function isDisjoint(...headers: (Record<string, unknown> | undefined)[]): boolean {
  const sources = headers.filter(Boolean) as Record<string, unknown>[];
  if (sources.length === 0 || sources.length === 1) return true;
  let acc: Set<string> | undefined;
  for (const header of sources) {
    const parameters = Object.keys(header);
    if (!acc || acc.size === 0) { acc = new Set(parameters); continue; }
    for (const parameter of parameters) {
      if (acc.has(parameter)) return false;
      acc.add(parameter);
    }
  }
  return true;
}

const kept: string[][] = [];
let seen = "";
let visitKey = (key: string): void => { seen += key; };
function visitAll(objects: Record<string, unknown>[]): number {
  for (const object of objects) {
    const keys = Object.keys(object);
    for (const key of keys) visitKey(key);
    kept.push(keys);
  }
  return kept.length;
}
function shrinksItsOwnList(objects: Record<string, unknown>[]): string {
  let text = "";
  for (const object of objects) {
    const keys = Object.keys(object);
    kept.push(keys);
    for (let i = 0; i < keys.length; i++) { text += keys[i] + ","; visitKey(keys[i]!); }
  }
  return text;
}

console.log(isDisjoint({ a: 1 }, { b: 2 }), isDisjoint({ a: 1 }, { a: 2 }, undefined), isDisjoint({ a: 1, b: 2 }, { c: 3 }, { d: 4, a: 5 }), isDisjoint(), isDisjoint({}, { a: 1 }, { a: 1 }));
console.log(visitAll([{ a: 1, b: 2 }, { c: 3 }, {}]), seen);
visitKey = key => { seen += key.toUpperCase(); if (kept.length) kept[0]!.length = 0; };
console.log(visitAll([{ a: 1, b: 2 }, { c: 3 }, {}]), seen, JSON.stringify(kept));
visitKey = () => { kept[kept.length - 1]!.length = 1; };
console.log(shrinksItsOwnList([{ a: 1, b: 2, c: 3 }, { d: 4, e: 5 }]), JSON.stringify(kept.slice(-2)));
