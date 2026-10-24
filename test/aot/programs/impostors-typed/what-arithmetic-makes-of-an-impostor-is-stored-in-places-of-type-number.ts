function show(value: unknown): string {
  if (typeof value === "bigint") return "bigint " + value + "n";
  if (typeof value === "number" && Object.is(value, -0)) return "number -0";
  if (typeof value === "object" && value !== null) return "object";
  return typeof value + " " + String(value);
}

function attempt(run: () => unknown): string {
  try {
    return show(run());
  } catch (error) {
    return "threw " + (error as Error).constructor.name;
  }
}

let lastProduct: number = 0;

class Ledger {
  static lastNegated: number = 0;
  sum: number = 0;
  entries: number[] = [];
}

function squared(side: number): number {
  return side * side;
}

function doubled(side: number): number {
  return side + side;
}

function negated(side: number): number {
  return -side;
}

function next(side: number): number {
  side++;
  return side;
}

function halved(side: number): number {
  return side / 2;
}

function storeEverywhere(ledger: Ledger, side: number): () => number {
  let captured: number = 0;
  lastProduct = side * side;
  Ledger.lastNegated = -side;
  ledger.sum = side + side;
  ledger.entries.push(side - side);
  captured = side * 3;
  return () => captured;
}

function useAsNumbers(ledger: Ledger, read: () => number): number {
  return lastProduct + Ledger.lastNegated + ledger.sum + ledger.entries[ledger.entries.length - 1] + read();
}

const warmLedger = new Ledger();
let warm = 0;
for (let i = 0; i < 2000; i++) {
  warm += squared(i) + doubled(i) + negated(i) + next(i) + halved(i);
  warm += storeEverywhere(warmLedger, i)();
}
console.log(
  "2000 honest rounds:",
  warm,
  useAsNumbers(warmLedger, () => 1),
  warmLedger.entries.length,
);

const changing = {
  turn: 0,
  valueOf() {
    return [1, 2n, "3", 4n][this.turn++ & 3];
  },
};

const impostors: [string, unknown][] = [
  ["a bigint", 3n],
  ["a string of digits", "4"],
  ["a string of letters", "ab"],
  ["null", null],
  ["undefined", undefined],
  ["true", true],
  ["a list of one number", [6]],
  ["a wrapped number", new Number(7)],
  ["an object whose valueOf answers a number", { valueOf: () => 8 }],
  ["an object whose valueOf answers a bigint", { valueOf: () => 9n }],
  ["an object whose valueOf answers a string", { valueOf: () => "10" }],
  ["an object whose valueOf answers another kind each time", changing],
  ["an object with Symbol.toPrimitive that answers a bigint", { [Symbol.toPrimitive]: () => 11n }],
  [
    "an object with Symbol.toPrimitive that answers by the hint",
    { [Symbol.toPrimitive]: (hint: string) => (hint === "number" ? 12n : "12") },
  ],
  [
    "an object whose valueOf throws",
    {
      valueOf() {
        throw new RangeError("no");
      },
    },
  ],
  ["a symbol", Symbol("s")],
];

for (const [name, impostor] of impostors) {
  const side = impostor as number;
  console.log(
    name + ":",
    "squared",
    attempt(() => squared(side)),
    "| doubled",
    attempt(() => doubled(side)),
    "| negated",
    attempt(() => negated(side)),
    "| next",
    attempt(() => next(side)),
    "| halved",
    attempt(() => halved(side)),
  );
  const ledger = new Ledger();
  lastProduct = 0;
  Ledger.lastNegated = 0;
  let read: () => number = () => 0;
  const stored = attempt(() => {
    read = storeEverywhere(ledger, side);
    return true;
  });
  console.log(
    name + ", stored " + stored + ":",
    "variable",
    show(lastProduct),
    "| static",
    show(Ledger.lastNegated),
    "| field",
    show(ledger.sum),
    "| element",
    show(ledger.entries[0]),
    "| captured",
    show(read()),
    "| used",
    attempt(() => useAsNumbers(ledger, read)),
  );
}

const again = new Ledger();
console.log(
  "honest again:",
  squared(5),
  doubled(5),
  negated(5),
  next(5),
  halved(5),
  storeEverywhere(again, 5)(),
  useAsNumbers(again, () => 1),
);
