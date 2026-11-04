// `n` is a small whole number where it is pushed. The loop behind may take it past 32 bits, so it is kept as a double from the start.
// The array holds nothing but int32s and is read as such.
function once(start: number): number {
  let n: number = start;
  const list: number[] = [start];
  n += 6;
  list.push(n);
  for (let x = 60; x < 61; x++) {
    n += x;
    console.log(n, list.length, list[0], list[1]);
  }
  return n;
}
console.log(once(3));

function ontoNothing(start: number): number {
  let n: number = start;
  const list: number[] = [];
  n += 6;
  list.push(n);
  list.push(n);
  for (let x = 60; x < 61; x++) {
    n += x;
    console.log(n, list.length, list[0], list[1]);
  }
  return n;
}
console.log(ontoNothing(3));

function* inSteps(start: number): Generator<number, number, unknown> {
  let n: number = start;
  const list: number[] = [start];
  n += 6;
  list.push(n);
  for (let x = 60; x < 61; x++) {
    n += x;
    console.log(n, list.length, list[0], list[1]);
    yield n;
  }
  return n;
}
const steps = inSteps(3);
console.log(JSON.stringify(steps.next()), JSON.stringify(steps.next()));

async function awaited(start: number): Promise<number> {
  let n: number = start;
  const list: number[] = [start];
  n += 6;
  list.push(n);
  for (let x = 60; x < 61; x++) {
    n += x;
    await null;
    console.log(n, list.length, list[0], list[1]);
  }
  return n;
}
console.log(await awaited(3));

// Hot, and more is pushed than the literal has room for.
function often(start: number): number {
  let n: number = start;
  const list: number[] = [start];
  n += 6;
  list.push(n);
  list.push(n);
  list.push(n);
  list.push(n);
  list.push(n);
  list.push(n);
  list.push(n);
  list.push(n);
  list.push(n);
  let sum = 0;
  for (let x = 60; x < 62; x++) {
    n += x;
    sum += list[0] + list[1] + list[5] + list[9] + list.length;
  }
  return sum + n;
}
let total = 0;
for (let i = 0; i < 30000; i++) total += often(3);
console.log(total);

// Behind a spread.
function behindASpread(start: number, first: number[]): number {
  let n: number = start;
  n += 6;
  const list: number[] = [...first, n];
  for (let x = 60; x < 61; x++) {
    n += x;
    console.log(n, list.length, list[0], list[1], list[2]);
  }
  return n;
}
console.log(behindASpread(3, [1, 2]));

// What is stored through such an array is found by everybody else.
function storedThrough(start: number): string {
  let n: number = start;
  const list: number[] = [start];
  n += 6;
  list.push(n);
  for (let x = 60; x < 61; x++) {
    n += x;
    list[0] = 7;
    list[1] = list[0] + 1;
  }
  return JSON.stringify(list) + " " + list.join() + " " + list.indexOf(8) + " " + list.includes(7) + " " + n;
}
console.log(storedThrough(3));
