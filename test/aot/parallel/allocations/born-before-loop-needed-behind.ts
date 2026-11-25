// What is made in front of a loop and needed behind it on one way alone is made there. It never comes to stand in a loop that did not hold it: one object stays one object, and a store in the loop stays with it.
// STATISTIC: AllocationsSunk >= 4
const numbers: number[] = JSON.parse("[3,1,4,1,5,9,2,6]");
const keep: unknown[] = [];
let made = 0;
function hand(callback: (value: number) => number, from: number): number {
  made++;
  return callback(from);
}

// The closure is needed on the rare way out alone.
function firstAbove(limit: number, by: number): number {
  const weigh = (value: number) => value * by + limit;
  for (let index = 0; index < numbers.length; index++) {
    if (numbers[index]! > limit) return numbers[index]!;
  }
  return hand(weigh, by);
}

// The object is needed behind two loops, one in the other.
function pairs(limit: number): unknown {
  const found = { limit, kind: "none" };
  let count = 0;
  for (const left of numbers) {
    for (const right of numbers) if (left * right > limit) count++;
  }
  if (count === 0) keep.push(found);
  return count || keep.length;
}

// It is needed in the loop: one object for all turns.
function sameEachTurn(limit: number): boolean {
  const one = { limit };
  const seen: object[] = [];
  for (const value of numbers) if (value > limit) seen.push(one);
  return seen.every(other => other === seen[0]);
}

// It is needed in the inner loop of two, made in the outer one: one for each turn of the outer.
function oneForEachOuterTurn(limit: number): number {
  const all = new Set<object>();
  for (const left of numbers) {
    const row = { left };
    for (const right of numbers) if (left + right > limit) all.add(row);
  }
  return all.size;
}

// A store in the loop, and the object behind it.
function lastStored(limit: number): unknown {
  const state = { last: -1, count: 0 };
  for (const value of numbers) {
    if (value < limit) continue;
    state.last = value;
    state.count++;
  }
  return limit > 8 ? state : state.last + state.count;
}

// The variable that the closure holds changes in the loop.
function holdsVariable(limit: number): number {
  let total = 0;
  const read = (extra: number) => total + extra;
  for (const value of numbers) total += value > limit ? value : 1;
  return limit === 2 ? hand(read, 100) : total;
}

// Made in a loop, needed behind the inner loop of the same turn on one way alone.
function inEachTurn(limit: number): string {
  const out: string[] = [];
  for (let turn = 0; turn < 4; turn++) {
    const label = { turn, limit };
    let found = -1;
    for (let index = 0; index < numbers.length; index++) {
      if (numbers[index] === turn + limit) {
        found = index;
        break;
      }
    }
    if (found < 0) keep.push(label), out.push("none " + (keep.at(-1) as typeof label).turn);
    else out.push(String(found));
  }
  return out.join();
}

// Needed where the loop throws.
function behindThrow(limit: number): string {
  const context = { limit, where: "loop" };
  try {
    for (const value of numbers) if (value === limit) throw new Error("at " + value);
  } catch (error) {
    return (error as Error).message + JSON.stringify(context);
  }
  return limit > 100 ? JSON.stringify(context) : "no";
}

// Two ways out of a labeled loop, and both need it.
function labeled(limit: number): unknown {
  const result = { limit, steps: 0 };
  let steps = 0;
  outer: for (const left of numbers) {
    for (const right of numbers) {
      steps++;
      if (right === limit) continue outer;
      if (left + right === 14) break outer;
    }
  }
  if (steps > limit) {
    result.steps = steps;
    return result;
  }
  return steps;
}

for (const limit of [0, 2, 8, 9, 100, 900]) {
  console.log(firstAbove(limit, 7), pairs(limit), sameEachTurn(limit), oneForEachOuterTurn(limit), lastStored(limit), holdsVariable(limit), inEachTurn(limit), behindThrow(limit), labeled(limit), made, keep.length);
}

// The closure that a copied method of lists is handed.
let hits = 0;
for (let turn = 0; turn < 12; turn++) {
  if (numbers.some(value => value > turn + 1)) hits++;
  hits += numbers.filter(value => value % 3 === turn % 3).length;
  if (turn === 9) numbers.length = 3;
  if (turn === 10) numbers[1] = 0.5;
}
console.log(hits);
