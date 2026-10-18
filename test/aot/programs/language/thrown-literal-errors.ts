function slot(table: readonly number[], at: number): number {
  if (at >= table.length) throw new RangeError("past the end");
  return table[at]!;
}

function follow(table: readonly number[], at: number, hops: number): number {
  const next = slot(table, at);
  return hops > 0 ? follow(table, next, hops - 1) * 2 + 1 : next;
}

function forbid(): never {
  throw new TypeError("forbidden");
}

function portrait(error: unknown): string {
  if (!(error instanceof Error)) return "no error at all: " + String(error);
  const parent = Object.getPrototypeOf(error);
  return [error.constructor.name, error.name, error.message, parent === RangeError.prototype ? "range" : parent === TypeError.prototype ? "type" : "other", typeof error.stack].join(" / ");
}

const ring: number[] = [];
for (let i = 0; i < 24; i++) ring.push(i + 1);
const followers: ((table: readonly number[], at: number, hops: number) => number)[] = [follow];
const forbidders: (() => never)[] = [forbid];

let tally = 0;
for (let round = 0; round < 2000; round++) {
  try {
    tally += followers[0](ring, round % 4, 100);
  } catch {
    tally += 3;
  }
}
console.log(String(tally));

for (const start of [24, 23, 3, 0]) {
  try {
    console.log(String(followers[0](ring, start, 100)));
  } catch (error) {
    console.log(portrait(error));
  }
}
console.log(String(followers[0](ring, 0, 5)), String(followers[0](ring, 20, 0)));

let tidied = "";
for (const mark of ["a", "b", "c"]) {
  try {
    try {
      forbidders[0]();
    } finally {
      tidied += mark;
    }
  } catch (error) {
    console.log(portrait(error), tidied);
  }
}

const caught: unknown[] = [];
for (let round = 0; round < 4; round++) {
  try {
    followers[0](ring, 22, 9);
  } catch (error) {
    caught.push(error);
  }
}
console.log(String(new Set(caught).size), String(caught[0] === caught[1]), String((caught[2] as Error).message === (caught[3] as Error).message));

async function afterATurn(start: number): Promise<number> {
  await undefined;
  return followers[0](ring, start, 40);
}
console.log(await afterATurn(21).then(String, portrait), await afterATurn(30).then(String, portrait));
