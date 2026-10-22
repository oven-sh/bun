// A variable stored once, while its reader is suspended, is loaded after the await. The negative cases are stored before the reader starts.
async function pause(): Promise<void> {}

let lateTable: number[];
const earlyTable: number[] = [10, 20, 30];

async function sumLateTable(): Promise<number> {
  await pause();
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += lateTable[i];
  return sum;
}

async function sumEarlyTable(): Promise<number> {
  await pause();
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += earlyTable[i];
  return sum;
}

function sumLateCapture(first: number): Promise<number> {
  let table: number[];
  async function sum(): Promise<number> {
    await pause();
    let total = 0;
    for (let i = 0; i < 3; i++) total += table[i];
    return total;
  }
  const pending = sum();
  table = [first, first + 1, first + 2];
  return pending;
}

function sumEarlyCapture(first: number): Promise<number> {
  const table: number[] = [first, first + 1, first + 2];
  async function sum(): Promise<number> {
    await pause();
    let total = 0;
    for (let i = 0; i < 3; i++) total += table[i];
    return total;
  }
  return sum();
}

function sumOwnCapture(first: number): number {
  let table: number[];
  const read = (i: number): number => table[i];
  table = [first, first * 2, first * 3];
  let total = 0;
  for (let i = 0; i < 3; i++) total += table[i] + read(i);
  return total;
}

const pending = sumLateTable();
lateTable = [1, 2, 3];
console.log(await pending, await sumEarlyTable());
for (let round = 0; round < 3; round++) {
  console.log(await sumLateCapture(round), await sumEarlyCapture(round), sumOwnCapture(round + 1));
}

export {};
