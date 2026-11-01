// Copies of objects with more names than a chain of Structures holds, and of mixtures of fields, added names, accessors and indexes.
type Bag = Record<string, unknown>;
type Known = { first?: number; second?: string; third?: boolean };

function bagOf(count: number, prefix: string): Bag {
  const bag: Bag = {};
  for (let index = 0; index < count; index++) bag[prefix + index] = index;
  return bag;
}

function lookedUp(bag: Bag): Bag {
  return new Proxy(bag, {});
}

function describe(value: object): string {
  const keys = Reflect.ownKeys(value);
  let sum = 0;
  for (const key of keys) {
    const item = (value as Record<PropertyKey, unknown>)[key];
    if (typeof item === "number") sum += item;
  }
  return keys.length + " keys, sum " + sum + ", " + keys.slice(0, 4).map(String).join(",") + " .. " + keys.slice(-4).map(String).join(",");
}

function copy(bag: Bag): Bag { return { ...bag }; }
function copyWithOne(bag: Bag): Bag { return { ...bag, added: 1 }; }
function copyBehindOne(bag: Bag): Bag { return { before: 1, ...bag }; }
function copyTwo(a: Bag, b: Bag): Bag { return { ...a, ...b }; }
function copyOntoKnown(bag: Bag): Known & Bag { return { first: 1, ...bag, third: true }; }
function copyOverAccessor(bag: Bag): Bag { return { get name3() { return "getter"; }, set name3(value: unknown) { throw new Error("called"); }, ...bag }; }

for (const count of [0, 1, 2, 3, 4, 60, 126, 127, 128, 129, 200, 600]) {
  for (let round = 0; round < 3; round++) {
    const bag = bagOf(count, "name");
    const other = bagOf(count >> 1, round ? "other" : "name");
    const mixed: Bag = { ...bagOf(3, "name"), second: "s", 7: "seven", ...bagOf(count, "late"), first: 5, [Symbol.for("mark")]: 9, 2: "two" };
    console.log(count, round, describe(copy(bag)), "|", describe(copyWithOne(bag)), "|", describe(copyBehindOne(bag)));
    console.log(count, round, describe(copyTwo(bag, other)), "|", describe(copyOntoKnown(mixed)), "|", describe(copyOverAccessor(bag)), Object.getOwnPropertyDescriptor(copyOverAccessor(bag), "name3")?.get === undefined);
    console.log(count, round, describe(copy(lookedUp(bag))), "|", describe(copyOntoKnown(lookedUp(mixed))), "|", describe(copyTwo(lookedUp(bag), lookedUp(other))), "|", describe(copyOverAccessor(lookedUp(bag))));
  }
}
