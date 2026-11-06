const which: string = process.argv[2] ?? "";
const rounds: number = Number(process.argv[3] ?? "64");

type Counts = Record<string, number>;
const namesOfList = (list: number, count: number): string[] =>
  Array.from({ length: count }, (_, k) => "n" + list + "_" + k * 7);
const asNames = (texts: string[]): string[] => Object.keys(Object.fromEntries(texts.map(text => [text, 0])));
function build(names: string[]): Counts {
  const seen: Counts = Object.create(null);
  for (let k = 0; k < names.length; k++) {
    const key = names[k];
    if (seen[key] !== undefined) continue;
    seen[key] = k;
  }
  return seen;
}
const oneList = asNames(namesOfList(0, 40));
const manyLists: string[][] = [];
for (let list = 1; list <= 8000; list++) manyLists.push(asNames(namesOfList(list, 40)));
const manyNames = asNames(namesOfList(9000, 320000));

const writtenOut: Counts = { a0: 0, a1: 1, a2: 2, a3: 3, a4: 4, a5: 5, a6: 6, a7: 7, a8: 8, a9: 9, a10: 10, a11: 11 };
const givenByKey: Counts = {};
for (let k = 0; k < 12; k++) givenByKey["a" + k] = k;
const asked = asNames(Array.from({ length: 24 }, (_, k) => "a" + k));

// A round of each loop handles forty names, but for the two that list twelve and the two that ask for twenty-four.
const loops: Record<string, (n: number) => number> = {
  "forty names that come again and again": n => {
    let s = 0;
    for (let i = 0; i < n; i++) s += build(oneList)[oneList[39]];
    return s;
  },
  "forty names that come once": n => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const names = manyLists[i];
      s += build(names)[names[39]];
    }
    return s;
  },
  "forty more names for one object": n => {
    const seen: Counts = Object.create(null);
    for (let k = 0; k < n * 40; k++) seen[manyNames[k]] = k;
    return seen[manyNames[n * 40 - 1]];
  },
  "a loop over names that were written out": n => {
    let s = 0;
    for (let i = 0; i < n; i++) for (const name in writtenOut) s += writtenOut[name];
    return s;
  },
  "a loop over names that were given by key": n => {
    let s = 0;
    for (let i = 0; i < n; i++) for (const name in givenByKey) s += givenByKey[name];
    return s;
  },
  "questions to names that were written out": n => {
    let s = 0;
    for (let i = 0; i < n; i++) for (let k = 0; k < asked.length; k++) if (writtenOut[asked[k]] !== undefined) s++;
    return s;
  },
  "questions to names that were given by key": n => {
    let s = 0;
    for (let i = 0; i < n; i++) for (let k = 0; k < asked.length; k++) if (givenByKey[asked[k]] !== undefined) s++;
    return s;
  },
};

if (which) console.log(which, loops[which](rounds));
else for (const name in loops) console.log(name, loops[name](rounds), loops[name](3));
