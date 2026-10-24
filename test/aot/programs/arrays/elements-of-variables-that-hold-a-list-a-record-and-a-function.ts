// A variable holds a list, later a record of a class that no test tells from others, and a function. Its elements are read and stored in a closure that is handed on: every kind of list, every kind of access.
let counter = 0;
const roads: ((seed: number) => string)[] = [];
const late: (() => string)[] = [];
const groups = (): any => Object.groupBy([1], () => "k");
const bound = (): any =>
  function (this: any) {
    return this;
  }.bind({});

let objects: any;
const takeObjects = (read: () => any): any => read();
roads.push(seed => ((objects = new Array(2).fill({ a: seed })), String(takeObjects(() => objects[1].a))));
late.push(() => ((objects = groups()), (objects = bound()), String(takeObjects(() => objects[1].a))));

let literal: any;
const takeLiteral = (read: () => any): any => read();
roads.push(
  seed => ((literal = [{ a: seed }, { a: seed + 1 }]), String(takeLiteral(() => literal[0].a + literal[1].a))),
);
late.push(() => ((literal = groups()), (literal = bound()), String(takeLiteral(() => literal[0].a + literal[1].a))));

let numbers: any;
const takeNumbers = (read: () => any): any => read();
roads.push(seed => ((numbers = [seed, seed + 1]), String(takeNumbers(() => numbers[1]))));
late.push(() => ((numbers = groups()), (numbers = bound()), String(takeNumbers(() => numbers[1]))));

let doubles: any;
const takeDoubles = (read: () => any): any => read();
roads.push(seed => ((doubles = [seed + 0.5, seed + 1.5]), String(takeDoubles(() => doubles[1]))));
late.push(() => ((doubles = groups()), (doubles = bound()), String(takeDoubles(() => doubles[1]))));

let holes: any;
const takeHoles = (read: () => any): any => read();
roads.push(seed => ((holes = [seed, , seed + 1]), String(takeHoles(() => holes[1]))));
late.push(() => ((holes = groups()), (holes = bound()), String(takeHoles(() => holes[1]))));

let frozen: any;
const takeFrozen = (read: () => any): any => read();
roads.push(seed => ((frozen = Object.freeze([seed, seed + 1])), String(takeFrozen(() => frozen[1]))));
late.push(() => ((frozen = groups()), (frozen = bound()), String(takeFrozen(() => frozen[1]))));

let made: any;
const takeMade = (read: () => any): any => read();
roads.push(seed => ((made = Array.from({ length: 2 }, () => seed)), String(takeMade(() => typeof made[1]))));
late.push(() => ((made = groups()), (made = bound()), String(takeMade(() => typeof made[1]))));

let stored: any;
const takeStored = (read: () => any): any => read();
roads.push(seed => ((stored = [seed, seed + 1]), String(takeStored(() => ((stored[1] = 7), stored[1])))));
late.push(() => ((stored = groups()), (stored = bound()), String(takeStored(() => ((stored[1] = 7), stored[1])))));

let grown: any;
const takeGrown = (read: () => any): any => read();
roads.push(seed => ((grown = [seed, seed + 1]), String(takeGrown(() => ((grown[5] = 7), grown.length)))));
late.push(() => ((grown = groups()), (grown = bound()), String(takeGrown(() => ((grown[5] = 7), grown.length)))));

let swapped: any;
const takeSwapped = (read: () => any): any => read();
roads.push(
  seed => (
    (swapped = [seed, seed + 1]),
    String(
      takeSwapped(() => {
        const before = swapped[0];
        swapped[0] = swapped[1];
        return before + ":" + swapped[0];
      }),
    )
  ),
);
late.push(
  () => (
    (swapped = groups()),
    (swapped = bound()),
    String(
      takeSwapped(() => {
        const before = swapped[0];
        swapped[0] = swapped[1];
        return before + ":" + swapped[0];
      }),
    )
  ),
);

let byCounter: any;
const takeByCounter = (read: () => any): any => read();
roads.push(seed => ((byCounter = [seed, seed + 1]), String(takeByCounter(() => byCounter[counter++ % 2]))));
late.push(() => ((byCounter = groups()), (byCounter = bound()), String(takeByCounter(() => byCounter[counter++ % 2]))));

let walked: any;
const takeWalked = (read: () => any): any => read();
roads.push(
  seed => (
    (walked = [seed, seed + 1]),
    String(
      takeWalked(() => {
        let sum = 0;
        for (let index = 0; index < walked.length; index++) sum += walked[index];
        return sum;
      }),
    )
  ),
);
late.push(
  () => (
    (walked = groups()),
    (walked = bound()),
    String(
      takeWalked(() => {
        let sum = 0;
        for (let index = 0; index < walked.length; index++) sum += walked[index];
        return sum;
      }),
    )
  ),
);

let searched: any;
const takeSearched = (read: () => any): any => read();
roads.push(seed => ((searched = [seed, seed + 1]), String(takeSearched(() => searched.indexOf(searched[1])))));
late.push(
  () => ((searched = groups()), (searched = bound()), String(takeSearched(() => searched.indexOf(searched[1])))),
);

let optional: any;
const takeOptional = (read: () => any): any => read();
roads.push(seed => ((optional = [{ a: seed }]), String(takeOptional(() => optional?.[0]?.a))));
late.push(() => ((optional = groups()), (optional = bound()), String(takeOptional(() => optional?.[0]?.a))));

let called: any;
const takeCalled = (read: () => any): any => read();
roads.push(
  seed => (
    (called = [seed, seed + 1]),
    String(takeCalled(() => (typeof called === "function" ? typeof called() : called[1])))
  ),
);
late.push(
  () => (
    (called = groups()),
    (called = bound()),
    String(takeCalled(() => (typeof called === "function" ? typeof called() : called[1])))
  ),
);

let bytes: any;
const takeBytes = (read: () => any): any => read();
roads.push(seed => ((bytes = new Uint8Array(4).fill(seed + 1)), String(takeBytes(() => bytes[1]))));
late.push(() => ((bytes = groups()), (bytes = bound()), String(takeBytes(() => bytes[1]))));

let bytesStored: any;
const takeBytesStored = (read: () => any): any => read();
roads.push(
  seed => (
    (bytesStored = new Uint8Array(4).fill(seed + 1)),
    String(takeBytesStored(() => ((bytesStored[1] = 300), bytesStored[1])))
  ),
);
late.push(
  () => (
    (bytesStored = groups()),
    (bytesStored = bound()),
    String(takeBytesStored(() => ((bytesStored[1] = 300), bytesStored[1])))
  ),
);

let floats: any;
const takeFloats = (read: () => any): any => read();
roads.push(seed => ((floats = new Float64Array(4).fill(seed + 0.5)), String(takeFloats(() => floats[1]))));
late.push(() => ((floats = groups()), (floats = bound()), String(takeFloats(() => floats[1]))));

let bigints: any;
const takeBigints = (read: () => any): any => read();
roads.push(seed => ((bigints = new BigInt64Array(2).fill(BigInt(seed))), String(takeBigints(() => bigints[1]))));
late.push(() => ((bigints = groups()), (bigints = bound()), String(takeBigints(() => bigints[1]))));

let buffer: any;
const takeBuffer = (read: () => any): any => read();
roads.push(seed => ((buffer = Buffer.alloc(4, seed + 1)), String(takeBuffer(() => buffer[1]))));
late.push(() => ((buffer = groups()), (buffer = bound()), String(takeBuffer(() => buffer[1]))));

let besideNoPrototype: any;
const takeBesideNoPrototype = (read: () => any): any => read();
roads.push(seed => ((besideNoPrototype = [seed, seed + 1]), String(takeBesideNoPrototype(() => besideNoPrototype[1]))));
late.push(
  () => (
    (besideNoPrototype = Object.create(null)),
    (besideNoPrototype = bound()),
    String(takeBesideNoPrototype(() => besideNoPrototype[1]))
  ),
);

let besideEntries: any;
const takeBesideEntries = (read: () => any): any => read();
roads.push(seed => ((besideEntries = [seed, seed + 1]), String(takeBesideEntries(() => besideEntries[1]))));
late.push(
  () => (
    (besideEntries = bound()),
    (besideEntries = Object.fromEntries([["1", "entry"]])),
    String(takeBesideEntries(() => besideEntries[1]))
  ),
);

let besideGroups: any;
const takeBesideGroups = (read: () => any): any => read();
roads.push(seed => ((besideGroups = [seed, seed + 1]), String(takeBesideGroups(() => besideGroups[1]))));
late.push(
  () => (
    (besideGroups = bound()),
    (besideGroups = Object.groupBy([1, 2], each => String(each))),
    String(takeBesideGroups(() => besideGroups[1]))
  ),
);

let besideGetter: any;
const takeBesideGetter = (read: () => any): any => read();
roads.push(seed => ((besideGetter = [seed, seed + 1]), String(takeBesideGetter(() => besideGetter[1]))));
late.push(
  () => (
    (besideGetter = groups()),
    (besideGetter = bound()),
    (besideGetter = Object.defineProperty([1, 2], "1", {
      get() {
        return "got";
      },
    })),
    String(takeBesideGetter(() => besideGetter[1]))
  ),
);

let besideListedArray: any;
const takeBesideListedArray = (read: () => any): any => read();
roads.push(seed => ((besideListedArray = [seed, seed + 1]), String(takeBesideListedArray(() => besideListedArray[1]))));
late.push(
  () => (
    (besideListedArray = bound()),
    (besideListedArray = Object(["x", "listed"])),
    String(takeBesideListedArray(() => besideListedArray[1]))
  ),
);

let packed: any;
const takePacked = (read: () => any): any => read();
function pack(_first: number, _second: number): void {
  packed = arguments;
}
roads.push(seed => {
  packed = [seed, seed + 1];
  const ofList = takePacked(() => packed[1]);
  pack(seed, seed + 2);
  return ofList + ":" + takePacked(() => packed[1]);
});
late.push(() => ((packed = groups()), (packed = bound()), String(takePacked(() => packed[1]))));

for (let turn = 0; turn < 3; turn++) console.log(roads.map(road => road(turn)).join());
for (const road of late) {
  try {
    console.log(road());
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
}
