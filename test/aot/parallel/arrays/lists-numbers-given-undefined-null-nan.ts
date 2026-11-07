// Lists of numbers that also hold undefined, null, NaN or a hole, each made, written and read in code of its own.
const lines: string[] = [];
function say(label: string, text: string): void {
  lines.push(label + ": " + text);
}
function textOf(value: unknown): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

function literalWithUndefined(): string {
  const list: (number | undefined)[] = [1, undefined, 3, undefined];
  let text = "";
  let sum = 0;
  for (let turn = 0; turn < 50; turn++) sum += list[turn & 3] ?? 7;
  for (let i = 0; i < 6; i++) text += (i in list ? "" : "~") + textOf(list[i]) + " ";
  return text + sum;
}

function literalWithNull(): string {
  const list: (number | null)[] = [null, 2.5, null, 4];
  let sum = 0;
  for (let turn = 0; turn < 50; turn++) {
    const value = list[turn & 3];
    sum += value == null ? 0.25 : value;
  }
  list[0] = 9;
  list[1] = null;
  return list.join("|") + " " + sum + " " + JSON.stringify(list);
}

function literalWithNaN(): string {
  const list: number[] = [1, 1 / 0, 2.5, NaN];
  let count = 0;
  for (let turn = 0; turn < 50; turn++) count += Number.isNaN(list[turn & 3]) ? 1 : Number.isFinite(list[turn & 3]) ? 10 : 100;
  return count + " " + list.includes(NaN) + " " + list.indexOf(NaN) + " " + list.map(textOf).join();
}

function literalWithHoles(): string {
  const list: (number | undefined)[] = [1, , 3, ,];
  let sum = 0;
  for (let turn = 0; turn < 50; turn++) sum += list[turn & 3] === undefined ? 7 : (list[turn & 3] as number);
  let text = "";
  for (let i = 0; i < 5; i++) text += (i in list ? "" : "~") + textOf(list[i]) + " ";
  list[1] = 2;
  list[3] = 4.5;
  return text + sum + " " + list.length + " " + list.join() + " " + (1 in list);
}

function fractionsWithHoles(): string {
  const list = [1.5, , 3.5, , 5.5] as number[];
  let sum = 0;
  for (let turn = 0; turn < 50; turn++) sum += list[turn % 5] ?? 0.125;
  return sum + " " + Object.keys(list).join() + " " + list.flat().join() + " " + [...list].map(textOf).join();
}

function emptyThenPushed(): string {
  const list: (number | undefined)[] = [];
  for (let i = 0; i < 6; i++) list.push(i);
  let before = 0;
  for (let i = 0; i < list.length; i++) before += list[i] as number;
  pushUndefined(list);
  let after = 0;
  for (let turn = 0; turn < 50; turn++) after += list[turn % list.length] ?? 100;
  return before + " " + after + " " + list.join("/") + " " + list.lastIndexOf(undefined);
}
function pushUndefined(list: (number | undefined)[]): void {
  list.push(undefined);
}

function emptyThenPushedFractionsAndNull(): string {
  const list: (number | null)[] = [];
  for (let i = 0; i < 6; i++) list.push(i + 0.5);
  let before = 0;
  for (let i = 0; i < list.length; i++) before += list[i] as number;
  list.push(null);
  list.push(-0);
  let text = "";
  for (const value of list) text += textOf(value) + " ";
  return before + " " + text;
}

function storedInsideTheLength(): string {
  const list: (number | undefined)[] = [10, 20, 30, 40];
  let sum = 0;
  for (let turn = 0; turn < 40; turn++) {
    const i = turn & 3;
    if (i < list.length) list[i] = turn % 5 === 0 ? undefined : turn;
    sum += list[(turn + 1) & 3] ?? -1;
  }
  return sum + " " + list.map(textOf).join();
}

function storedNaNInsideTheLength(): string {
  const list: number[] = [0.5, 1.5, 2.5, 3.5];
  let text = "";
  for (let turn = 0; turn < 12; turn++) {
    const i = turn & 3;
    if (i < list.length) list[i] = turn === 6 ? NaN : turn + 0.5;
    text += textOf(list[2]) + " ";
  }
  return text + list.join();
}

function oneReaderOfTwoMakers(): string {
  const whole: (number | undefined)[] = [1, 2, 3, 4];
  const mixed: (number | undefined)[] = [5, undefined, 7, 8];
  let sum = 0;
  for (let turn = 0; turn < 60; turn++) {
    const list = turn % 3 ? whole : mixed;
    sum += list[turn & 3] ?? 1000;
  }
  whole[2] = 2.5;
  whole.push(6);
  return sum + " " + whole.join() + " " + mixed.join() + " " + whole.indexOf(2.5) + " " + whole.sort().join();
}

function oneReaderOfThreeMakersOfFractions(): string {
  const lists: number[][] = [[1.5, 2.5], [3, 4], [NaN, 6.5]];
  let sum = 0;
  let count = 0;
  for (let turn = 0; turn < 60; turn++) {
    const value = lists[turn % 3][turn & 1];
    if (value !== value) count++;
    else sum += value;
  }
  return sum + " " + count + " " + lists.map(list => list.map(textOf).join()).join(";");
}

class Slots {
  values: (number | null)[] = [null, null, null, null];
  used = 0;
  take(value: number): number {
    for (let i = 0; i < this.values.length; i++) {
      if (this.values[i] === null) {
        this.values[i] = value;
        this.used++;
        return i;
      }
    }
    return -1;
  }
  free(i: number): void {
    if (i >= 0 && i < this.values.length && this.values[i] !== null) {
      this.values[i] = null;
      this.used--;
    }
  }
}
function slotsOfAnInstance(): string {
  const slots = new Slots();
  let text = "";
  for (let turn = 0; turn < 30; turn++) {
    text += slots.take(turn * 1.5);
    if (turn % 3 === 1) slots.free(turn & 3);
  }
  return text + " " + slots.used + " " + slots.values.join();
}

function takenApart(turns: number): string {
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    const [a, b = 5, c] = [turn, undefined, null];
    sum += a + b + (c ?? 2);
  }
  return String(sum);
}

function returnedByAFunction(): string {
  let text = "";
  for (let turn = 0; turn < 8; turn++) {
    const pair = pairOf(turn);
    text += textOf(pair[0]) + textOf(pair[1]) + " ";
  }
  return text;
}
function pairOf(turn: number): (number | undefined)[] {
  return turn & 1 ? [turn, undefined] : [turn, turn + 1];
}

function handedToBuiltIns(): string {
  const list: (number | undefined | null)[] = [3, undefined, 1, null, 2];
  const sorted = list.slice().sort();
  const reversed = list.slice().reverse();
  const filled = list.slice().fill(0.5, 1, 3);
  const joined = list.concat([NaN, 4], list);
  return [sorted, reversed, filled, joined, list.filter(value => value != null), list.with(0, undefined), list.toSpliced(1, 2, NaN)].map(each => each.map(textOf).join()).join(";") + " " + list.findLast(value => value == null) + " " + list.at(-2);
}

function madeShorterAndLonger(): string {
  const list: (number | undefined)[] = [1, undefined, 3];
  list.length = 1;
  list.push(4);
  list.length = 5;
  let text = "";
  for (let i = 0; i < list.length; i++) text += (i in list ? "" : "~") + textOf(list[i]) + " ";
  list.pop();
  list.shift();
  list.unshift(undefined, 8);
  return text + list.map(textOf).join() + " " + list.length;
}

function storedFarPastTheEnd(): string {
  const list: (number | null)[] = [1, null];
  list[40] = 2;
  list[100000] = 3;
  let count = 0;
  for (const key in list) count += Number(key);
  return count + " " + list.length + " " + textOf(list[39]) + textOf(list[40]) + textOf(list[1]);
}

function besideSomethingThatIsNoArray(): string {
  const things: ((number | undefined)[] | { length: number; [index: number]: number | undefined })[] = [[1, undefined, 3], { length: 3, 0: 4, 2: 6 }, [7, 8, 9]];
  let sum = 0;
  for (let turn = 0; turn < 60; turn++) sum += things[turn % 3][turn % 4] ?? 0.5;
  return String(sum);
}

function givenAnythingLater(): string {
  const list: unknown[] = [1, undefined, 2];
  let text = "";
  for (let turn = 0; turn < 6; turn++) {
    if (turn === 3) list[1] = "text";
    if (turn === 4) list[0] = { toString: () => "object" };
    text += String(list[0]) + String(list[1]) + " ";
  }
  return text;
}

const shared: (number | undefined)[] = [1, undefined, 3, undefined];
function readShared(i: number): number {
  return shared[i & 3] ?? 7;
}
function writeShared(i: number, value: number | undefined): void {
  if (i < shared.length) shared[i] = value;
}
function sharedByFunctions(): string {
  let sum = 0;
  for (let turn = 0; turn < 100; turn++) {
    sum += readShared(turn);
    if (turn === 50) writeShared(1, 2.25);
    if (turn === 70) writeShared(0, undefined);
  }
  return sum + " " + shared.join();
}

const table: readonly (number | null | undefined)[] = [
  0, 1, null, 3, 4, undefined, 6, 7, 8, 9, 10, null, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47,
  48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, null,
];
function longTable(): string {
  let sum = 0;
  let missing = 0;
  for (let turn = 0; turn < 300; turn++) {
    const value = table[turn % table.length];
    if (value == null) missing++;
    else sum += value;
  }
  return sum + " " + missing;
}

say("literal with undefined", literalWithUndefined());
say("literal with null", literalWithNull());
say("literal with NaN", literalWithNaN());
say("literal with holes", literalWithHoles());
say("fractions with holes", fractionsWithHoles());
say("empty then pushed", emptyThenPushed());
say("empty then pushed fractions and null", emptyThenPushedFractionsAndNull());
say("stored inside the length", storedInsideTheLength());
say("NaN stored inside the length", storedNaNInsideTheLength());
say("one reader of two makers", oneReaderOfTwoMakers());
say("one reader of three makers of fractions", oneReaderOfThreeMakersOfFractions());
say("slots of an instance", slotsOfAnInstance());
say("taken apart", takenApart(40));
say("returned by a function", returnedByAFunction());
say("handed to built-ins", handedToBuiltIns());
say("made shorter and longer", madeShorterAndLonger());
say("stored far past the end", storedFarPastTheEnd());
say("beside something that is no array", besideSomethingThatIsNoArray());
say("given anything later", givenAnythingLater());
say("shared by functions", sharedByFunctions());
say("long table", longTable());
console.log(lines.join("\n"));
