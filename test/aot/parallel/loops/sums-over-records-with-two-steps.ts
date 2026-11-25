const said: string[] = [];

function firstOfForty(word: number): string {
  const marks = new Uint8Array(40);
  for (let i = 0; i < 40; i++) marks[i] = i + 1;
  let turn = 0;
  let missing = 0;
  while (word) {
    if (marks[turn] === undefined) missing++;
    turn++;
    if (word & (word - 1)) {
      word &= word - 1;
      continue;
    }
    word >>>= 1;
  }
  return turn + " " + missing;
}

function firstOfFifty(word: number): string {
  const marks = new Float64Array(50);
  for (let i = 0; i < 50; i++) marks[i] = i + 0.5;
  let turn = 0;
  let missing = 0;
  while (word) {
    if (marks[turn] === undefined) missing++;
    turn++;
    if (word === (word & -word)) {
      word >>>= 1;
      continue;
    }
    word = word & (word - 1);
  }
  return turn + " " + missing;
}

function roomForAll(word: number): string {
  const marks = new Int32Array(64);
  for (let i = 0; i < 64; i++) marks[i] = i * 3;
  let turn = 0;
  let sum = 0;
  let missing = 0;
  while (word) {
    const mark = marks[turn];
    if (mark === undefined) missing++;
    else sum += mark;
    turn++;
    if (word & (word - 1)) {
      word &= word - 1;
      continue;
    }
    word >>>= 1;
  }
  return turn + " " + sum + " " + missing;
}

function besideShifts(word: number): string {
  const marks = new Uint16Array(32);
  for (let i = 0; i < 32; i++) marks[i] = i + 7;
  let turn = 0;
  let sum = 0;
  let missing = 0;
  while (word) {
    const mark = marks[turn];
    if (mark === undefined) missing++;
    else if (word & 1) sum += mark;
    turn++;
    if (word & 2) {
      word >>>= 2;
      continue;
    }
    word >>>= 1;
  }
  return turn + " " + sum + " " + missing;
}

function besideMasks(word: number): string {
  const marks = new Uint16Array(33);
  for (let i = 0; i < 33; i++) marks[i] = i + 9;
  let turn = 0;
  let sum = 0;
  let missing = 0;
  while (word) {
    const mark = marks[turn];
    if (mark === undefined) missing++;
    else sum += mark;
    turn++;
    word &= word - 1;
  }
  return turn + " " + sum + " " + missing;
}

function backward(word: number): string {
  const marks = new Uint8Array(60);
  for (let i = 0; i < 60; i++) marks[i] = 60 - i;
  let at = 41;
  let missing = 0;
  while (word) {
    if (marks[at] === undefined) missing++;
    at--;
    if (word & (word - 1)) {
      word &= word - 1;
      continue;
    }
    word >>>= 1;
  }
  return at + " " + missing;
}

function byThrees(word: number): string {
  const marks = new Int16Array(100);
  for (let i = 0; i < 100; i++) marks[i] = i - 50;
  let at = 0;
  let missing = 0;
  while (word) {
    if (marks[at] === undefined) missing++;
    if (word & (word - 1)) {
      at += 3;
      word &= word - 1;
      continue;
    }
    at += 2;
    word >>>= 1;
  }
  return at + " " + missing;
}

function sumOf(word: number, by: number): string {
  let sum = 0;
  let turns = 0;
  while (word) {
    sum += by | 0;
    turns++;
    if (word & (word - 1)) {
      word &= word - 1;
      continue;
    }
    word >>>= 1;
  }
  return turns + " " + sum;
}

const none = process.argv.length >> 8;
const words = [~none, none, 1 | none, 2147483647 - none, -2147483648 + none, 0x55555555 ^ none, -1431655766 - none, 0xf0f0f0f0 + none, 4294967295 - none, 2 ** 40 + 12345 + none, 2 ** 33 + none, -(2 ** 35) - 1 - none];
for (const word of words) {
  said.push(firstOfForty(word), firstOfFifty(word), roomForAll(word), besideShifts(word), besideMasks(word));
  said.push(backward(word), byThrees(word), sumOf(word, word));
}
said.push(firstOfForty(~none), firstOfFifty(~none), roomForAll(~none));
console.log(said.length);
for (const line of said) console.log(line);
