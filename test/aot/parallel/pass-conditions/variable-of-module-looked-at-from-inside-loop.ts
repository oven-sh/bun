// Loops in functions add to a variable of the module, and something in the loop looks at the variable or changes it by another way: a call, a getter, a conversion, a throw that is caught outside.
// Each sees what the turns before it have stored.
let count = 0;
const seen: number[] = [];

function look(): void {
  seen.push(count);
}

function bump(): void {
  count += 100;
}

const watcher = {
  get now(): number {
    return count;
  },
  valueOf(): number {
    count += 1000;
    return 1;
  },
};

function callsALooker(turns: number): void {
  for (let i = 0; i < turns; i++) {
    count += 1;
    look();
  }
}

function callsAChanger(turns: number): void {
  for (let i = 0; i < turns; i++) {
    count += 1;
    if (i === 2) bump();
  }
}

function readsAGetter(turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    count += 1;
    sum += watcher.now;
  }
  return sum;
}

function convertsAnObject(turns: number): void {
  for (let i = 0; i < turns; i++) count += (watcher as unknown as number) * 2;
}

function asksTheBound(): void {
  for (let i = 0; i < (watcher as unknown as number) * 3; i++) count += 1;
}

function throwsInTheThirdTurn(turns: number): void {
  for (let i = 0; i < turns; i++) {
    count += 1;
    if (i === 2) throw new RangeError("third");
  }
}

function readsOfNothing(turns: number, holder: { size: number } | null): void {
  for (let i = 0; i < turns; i++) {
    count += 1;
    count += holder!.size;
  }
}

function catchesInside(turns: number): void {
  for (let i = 0; i < turns; i++) {
    try {
      count += 1;
      if (i & 1) throw new Error("odd");
      count += 10;
    } catch {
      count += 5;
    }
  }
}

function* yields(turns: number): Generator<number> {
  for (let i = 0; i < turns; i++) {
    count += 1;
    yield i;
  }
}

async function awaits(turns: number): Promise<void> {
  for (let i = 0; i < turns; i++) {
    count += 1;
    await null;
  }
}

callsALooker(4);
console.log(count, seen.join(","));
callsAChanger(5);
console.log(count);
console.log(readsAGetter(4), count);
convertsAnObject(3);
console.log(count);
asksTheBound();
console.log(count);
try {
  throwsInTheThirdTurn(9);
} catch (error) {
  console.log((error as Error).message, count);
}
try {
  readsOfNothing(3, { size: 2 });
  readsOfNothing(3, null);
} catch (error) {
  console.log((error as Error).name, count);
}
catchesInside(5);
console.log(count);
for (const step of yields(3)) console.log(step, count);
const waiting = awaits(3);
console.log(count);
count += 10000;
await waiting;
console.log(count);
