// `for (let k = 0; k < list.length; k++) list[k] = <something new>`: the comparison says that k lies inside the list, and the store comes behind whatever makes the new element.
// Where that only allocates, the list is as long at the store as it was at the comparison. Where it cuts, empties, grows or replaces the storage of the list, it is not.
type Entry = { weight: number };

let shared: Entry[] = [];
let turns = 0;

function describe(list: (Entry | undefined)[]): string {
  let text = list.length + ":";
  for (let k = 0; k < list.length; k++) text += (k in list ? (list[k] === undefined ? "u" : list[k]!.weight) : "-") + ",";
  return text;
}

function eight(): Entry[] {
  const list: Entry[] = [];
  for (let k = 0; k < 8; k++) list.push({ weight: k + 0.5 });
  return list;
}

function onlyAllocates(list: Entry[], weight: number): void {
  for (let k = 0; k < list.length; k++) list[k] = { weight: weight + k };
}

function allocatesTwice(list: Entry[], weight: number): void {
  for (let k = 0; k < list.length; k++) {
    const pair = [{ weight: weight + k }, { weight: weight - k }];
    list[k] = pair[k & 1]!;
  }
}

function readsBehindAnAllocation(list: Entry[], weight: number): number {
  let sum = 0;
  for (let k = 0; k < list.length; k++) {
    const made = { weight: weight + k };
    sum += list[k]!.weight + made.weight;
  }
  return sum;
}

function comparedTheOtherWayRound(list: Entry[], weight: number): void {
  for (let k = 0; list.length > k; k++) list[k] = { weight: weight * 2 + k };
}

function cutTo(length: number, weight: number): Entry {
  if (++turns % 5 === 3) shared.length = length;
  return { weight };
}

function cutByTheNewElement(list: Entry[], length: number): void {
  for (let k = 0; k < list.length; k++) list[k] = cutTo(length, k + 100);
}

function popped(weight: number): Entry {
  if (++turns % 3 === 1) shared.pop();
  return { weight };
}

function poppedByTheNewElement(list: Entry[]): void {
  for (let k = 0; k < list.length; k++) list[k] = popped(k + 200);
}

function grown(weight: number): Entry {
  if (shared.length < 12) shared.push({ weight: -weight });
  return { weight };
}

function grownByTheNewElement(list: Entry[]): void {
  for (let k = 0; k < list.length; k++) list[k] = grown(k + 300);
}

function cutInPlace(list: Entry[]): void {
  for (let k = 0; k < list.length; k++) {
    const made = { weight: k + 400 };
    if (k === 5) list.length = 2;
    list[k] = made;
  }
}

function cutByAConversion(list: Entry[]): void {
  const cutter = {
    valueOf(): number {
      shared.length = 1;
      return 7;
    },
  };
  for (let k = 0; k < list.length && k < 6; k++) list[k] = { weight: k === 3 ? +cutter : k + 500 };
}

function givenAFarElement(weight: number): Entry {
  if (++turns % 7 === 2) (shared as (Entry | undefined)[])[40] = { weight: 40 };
  return { weight };
}

function spreadOutByTheNewElement(list: Entry[]): void {
  for (let k = 0; k < list.length && k < 48; k++) list[k] = givenAFarElement(k + 600);
}

function frozenByTheNewElement(list: Entry[]): string {
  try {
    for (let k = 0; k < list.length; k++) {
      const made = { weight: k + 700 };
      if (k === 4) Object.freeze(list);
      list[k] = made;
    }
  } catch (error) {
    return (error as Error).constructor.name;
  }
  return "no error";
}

for (let round = 0; round < 4; round++) {
  shared = eight();
  onlyAllocates(shared, round);
  console.log("only allocates", describe(shared));
  allocatesTwice(shared, round);
  console.log("allocates twice", describe(shared));
  console.log("reads behind an allocation", readsBehindAnAllocation(shared, round));
  comparedTheOtherWayRound(shared, round);
  console.log("compared the other way round", describe(shared));

  shared = eight();
  cutByTheNewElement(shared, round);
  console.log("cut", describe(shared));
  shared = eight();
  poppedByTheNewElement(shared);
  console.log("popped", describe(shared));
  shared = eight();
  grownByTheNewElement(shared);
  console.log("grown", describe(shared));
  shared = eight();
  cutInPlace(shared);
  console.log("cut in place", describe(shared));
  shared = eight();
  cutByAConversion(shared);
  console.log("cut by a conversion", describe(shared));
  shared = eight();
  spreadOutByTheNewElement(shared);
  console.log("spread out", describe(shared));
  shared = eight();
  console.log("frozen", frozenByTheNewElement(shared), describe(shared));
}

const empty: Entry[] = [];
onlyAllocates(empty, 1);
console.log("empty", describe(empty));
