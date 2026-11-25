// An object lies in a variable before its fields are filled. An accessor of another literal runs, or a store through it fails: both see the object there.
const seen: string[] = [];

interface Counted {
  id: number;
  count?: number;
}
let counted: Counted = { id: 0, count: 1 };
function readsThroughGetter(id: number): Counted {
  const other = { name: "other", get count(): number | undefined { return counted.count; } };
  const made: Counted = { id };
  counted = made;
  const count = other.count;
  made.count = 5;
  seen.push(String(count));
  return made;
}

interface Weighed {
  id: number;
  weight?: number;
}
let weighed: Weighed = { id: 0, weight: 1 };
function storesThroughSetter(id: number): Weighed {
  const other = { name: "other", get weight() { return 1; }, set weight(value: number) { seen.push(value + " " + weighed.weight); } };
  const made: Weighed = { id };
  weighed = made;
  other.weight = 3;
  made.weight = 5;
  return made;
}

interface Measured {
  id: number;
  width?: number;
}
let measured: Measured = { id: 0, width: 1 };
function failsInStore(id: number): Measured {
  const other: any = { name: "other", get width() { return 1; } };
  const made: Measured = { id };
  measured = made;
  other.width = 3;
  made.width = 5;
  return made;
}

interface Filled {
  id: number;
  depth?: number;
}
let filled: Filled = { id: 0, depth: 1 };
function fillsAlone(id: number): number {
  const made: Filled = { id };
  filled = made;
  made.depth = id + 1;
  return filled.depth! + made.depth;
}

for (let id = 1; id < 4; id++) {
  readsThroughGetter(id);
  storesThroughSetter(id);
  try {
    failsInStore(id);
  } catch (error) {
    seen.push((error as Error).constructor.name + " " + measured.width);
  }
  seen.push(String(fillsAlone(id)));
}
console.log(seen.join("\n"));
export {};
