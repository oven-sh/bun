// Sums in loops over a list or a text that go up or down by more than 32 bits in each turn.
function inShortInnerLoop(x: number, list: number[]): number {
  let n = x;
  for (let i = 0; i < list.length; i++)
    for (let j = 0; j < 4; j++)
      n += 2147483647;
  return n;
}

function writtenOut(x: number, list: number[]): number {
  let n = x;
  for (let i = 0; i < list.length; i++) {
    n += 2147483647;
    n += 2147483647;
    n += 2147483647;
    n += 2147483647;
  }
  return n;
}

function goingDown(x: number, list: number[]): number {
  let n = x;
  for (const _ of list)
    for (let j = 0; j < 4; j++)
      n -= 2147483647;
  return n;
}

function overText(x: number, text: string): number {
  let n = x;
  for (let i = 0; i < text.length; i++) {
    n += 1073741824;
    n += 1073741824;
    n += 1073741824;
    n += 1073741824;
  }
  return n;
}

function comparedBehindLoop(x: number, list: number[]): string {
  let n: number = x | 0;
  for (let i = 0; i < list.length; i++) {
    n += 2147483647;
    n += 2147483647;
    n += 4;
  }
  return n > 7000000000 ? "over" : "within";
}

function comparedGoingDown(x: number, list: number[]): string {
  let n: number = x | 0;
  for (let i = 0; i < list.length; i++) {
    n -= 2147483647;
    n -= 2147483647;
    n -= 4;
  }
  return n < -7000000000 ? "under" : "within";
}

const given: number[][] = JSON.parse(process.argv.length > 5 ? "[[1],[2]]" : "[[0],[0,0,0]]");
console.log(inShortInnerLoop(1, [0]));
console.log(writtenOut(1, [0]), writtenOut(1, [0, 0, 0]));
console.log(goingDown(1, [0]), goingDown(1, [0, 0, 0]));
console.log(overText(1, "a"), overText(1, "abc"));
console.log(comparedBehindLoop(given[0]!.length, given[0]!), comparedBehindLoop(given[0]!.length, given[1]!));
console.log(comparedGoingDown(given[0]!.length, given[0]!), comparedGoingDown(given[0]!.length, given[1]!));
