// Closures that are handed through a helper change the list that findLastIndex is walking: its length, the kind of its elements, its holes, an accessor.
function read2(each: () => () => number) {
  return { held: each() }.held();
}
function walk(change: number) {
  const made: (() => () => number)[] = [];
  let part: any[] = [];
  for (const name in { a: 1, bc: 2, def: 3, ghij: 4 })
    made.push(() => () => {
      if (change === 1) part.length = 1;
      if (change === 2) part[0] = 1.5;
      if (change === 3) delete part[1];
      if (change === 4) part[100000] = () => () => 7;
      if (change === 5) part.unshift(() => () => 2);
      if (change === 6) Object.defineProperty(part, 0, { get: () => () => () => 9 });
      return name.length;
    });
  part = made.slice(0, 4);
  let seen = "";
  let found: any;
  try {
    found = part.findLastIndex(each => {
      seen += typeof each + ",";
      return read2(each) % 7 === 6;
    });
  } catch (error: any) {
    found = error.name;
  }
  return change + ": " + found + " " + seen + " " + part.length;
}
const lines = new Set<string>();
for (let turn = 0; turn < 700; turn++) lines.add(walk(turn < 300 ? 0 : turn % 7));
for (const line of lines) console.log(line);
console.log(Reflect.apply(read2, undefined, [() => () => 5]));
