// A Map or a Set is asked, in a loop, with a string that is another string object than the key it holds and has the same text:
// names split out of one line twice, names written twice, names of an object's members. Beside them keys that it lacks, keys that are no strings, and texts that are joined anew.
export {};

const line = process.env.NO_SUCH_LINE_OF_NAMES ?? "ann,bob,cy,dee,eve,fay,gus,hal,ivy,jon,kim,lee,max,ned,oda,pam";

function filled(names: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let k = 0; k < names.length; k++) map.set(names[k]!, k + 1);
  return map;
}
function sumOf(map: Map<string, number>, asked: string[], turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += map.get(asked[i % asked.length]!) ?? -1;
  return sum;
}
function held(set: Set<string>, asked: string[], turns: number): number {
  let count = 0;
  for (let i = 0; i < turns; i++) if (set.has(asked[i % asked.length]!)) count++;
  return count;
}
function heldInMap(map: Map<string, number>, asked: string[], turns: number): number {
  let count = 0;
  for (let i = 0; i < turns; i++) if (map.has(asked[i % asked.length]!)) count++;
  return count;
}

const once = line.split(",");
const again = line.split(",");
for (const size of [3, 8, 9, 16]) {
  const map = filled(once.slice(0, size));
  console.log("split twice", size, sumOf(map, again, 64), heldInMap(map, again, 64), held(new Set(once.slice(0, size)), again, 64));
}

const pairs = new Map([["ann", 30], ["bob", 25], ["cy", 41], ["dee", 19]]);
const written = ["ann", "zed", "bob", "yan", "cy", "dee"];
console.log("written twice", sumOf(pairs, written, 60), sumOf(pairs, again, 64), heldInMap(pairs, written, 60));

const record: Record<string, number> = { ann: 1, bob: 2, zed: 3, cy: 4, pam: 5 };
console.log("names of members", sumOf(filled(once), Object.keys(record), 50), held(new Set(once), Object.keys(record), 50));
const listed: string[] = [];
for (const name in record) listed.push(name);
console.log("names out of for-in", sumOf(filled(once), listed, 50), held(new Set(again), listed, 50));

const many: string[] = [];
for (let k = 0; k < 600; k++) many.push("name" + k);
const manyAgain = many.join(",").split(",");
const half = many.filter((_, k) => k % 2 === 0);
console.log("six hundred", sumOf(filled(many), manyAgain, 1200), sumOf(filled(half), manyAgain, 1200), held(new Set(half), manyAgain, 1200));

const mixed = new Map<unknown, number>();
const anObject = { name: "ann" };
mixed.set(anObject, 1).set("ann", 2).set(null, 3).set(undefined, 4).set(true, 5).set("bob", 6).set(7, 8).set("7", 9);
function sumOfMixed(asked: string[], turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += mixed.get(asked[i % asked.length]!) ?? -1;
  return sum;
}
console.log("beside other keys", sumOfMixed(again, 32), sumOfMixed(["7", "true", "null", "undefined", "[object Object]"].join(",").split(","), 20));

function joinedAnew(map: Map<string, number>, turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const key = "name" + (i % 700);
    sum += map.get(key) ?? -1;
  }
  return sum;
}
console.log("joined anew", joinedAnew(filled(many), 1400), joinedAnew(filled(manyAgain), 1400));

const kept = new Map<string, number>();
for (let k = 0; k < 40; k++) kept.set("part" + k + "/" + (k % 3), k);
const keptAsked: string[] = [];
for (let k = 0; k < 60; k++) keptAsked.push(["part" + k, String(k % 3)].join("/"));
console.log("kept as they were joined", sumOf(kept, keptAsked, 120), heldInMap(kept, keptAsked, 120));
