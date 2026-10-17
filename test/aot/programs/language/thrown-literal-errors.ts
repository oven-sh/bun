// CALLS+ descend ThrowAtSite
// CALLS+ refuse ThrowAtSite
function descend(depth: number): number {
  if (depth === 0) throw new RangeError("deep");
  return descend(depth - 1) + 1;
}

function refuse(): never {
  throw new TypeError("refused");
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return "not an error: " + String(error);
  return [error.name, error.message, error.constructor.name, Object.getPrototypeOf(error) === RangeError.prototype, Object.getPrototypeOf(error) === TypeError.prototype, typeof error.stack].join(" | ");
}

const descenders: ((depth: number) => number)[] = [descend];
const refusers: (() => never)[] = [refuse];

let ignored = 0;
for (let i = 0; i < 2000; i++) {
  try {
    ignored += descenders[0](20);
  } catch {
    ignored += 1;
  }
}
console.log(String(ignored));

for (const depth of [0, 1, 20]) {
  try {
    console.log(String(descenders[0](depth)));
  } catch (error) {
    console.log(describe(error));
  }
}

let cleanups = 0;
for (let i = 0; i < 3; i++) {
  try {
    try {
      refusers[0]();
    } finally {
      cleanups++;
    }
  } catch (error) {
    console.log(describe(error), String(cleanups));
  }
}

const distinct = new Set<unknown>();
for (let i = 0; i < 4; i++) {
  try {
    descenders[0](2);
  } catch (error) {
    distinct.add(error);
  }
}
console.log(String(distinct.size));

async function later(): Promise<number> {
  await null;
  return descenders[0](3);
}
console.log(await later().then(String, describe));
