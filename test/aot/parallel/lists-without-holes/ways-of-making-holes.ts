// Each function makes a hole in its own list in one way, in the middle of the loops that read it.
interface Item {
  value: number;
}
const turns = Number(process.argv[2] ?? 6);
function item(value: number): Item {
  return { value };
}
function valueOf(read: Item | undefined): number {
  return read === undefined ? 1000 : read.value;
}
function storeAt(list: Item[], index: number) {
  list[index] = item(50);
}

function storedElsewhere() {
  const list: Item[] = [item(1), item(2), item(3)];
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    if (turn === 3) storeAt(list, 7);
    for (let i = 0; i < list.length; i++) sum += valueOf(list[i]);
  }
  return sum;
}
function storedByPattern() {
  const list: Item[] = [item(1), item(2), item(3)];
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    if (turn === 3) [list[7]] = [item(50)];
    for (const read of list) sum += valueOf(read);
  }
  return sum;
}
function storedByHeadOfLoop() {
  const list: Item[] = [item(1), item(2), item(3)];
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    if (turn === 3) for (list[7] of [item(50)]);
    for (let i = 0; i < list.length; i++) sum += valueOf(list[i]);
  }
  return sum;
}
function storedIfAbsent() {
  const list: Item[] = [item(1), item(2), item(3)];
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    list[6] ??= item(50);
    for (let i = 0; i < list.length; i++) sum += valueOf(list[i]);
  }
  return sum;
}
function lengthened() {
  const list: Item[] = [item(1), item(2), item(3)];
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    if (turn === 3) list.length += 2;
    for (let i = 0; i < list.length; i++) sum += valueOf(list[i]);
  }
  return sum;
}
function shortenedAndLengthened() {
  const list: number[] = [];
  for (let i = 0; i < 8; i++) list.push(i);
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    list.length = 2;
    list.length = 6;
    for (let i = 0; i < list.length; i++) sum += list[i] ?? 100;
  }
  return sum;
}
function emptiedAndLengthened() {
  const list: number[] = [];
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    list.length = 0;
    for (let i = 0; i < 4; i++) list.push(i + turn);
    for (let i = 0; i < list.length; i++) sum += list[i] === undefined ? 1000 : list[i];
    list.length = 3 + turn;
    for (let i = 0; i < list.length; i++) sum += list[i] === undefined ? 1000 : list[i];
  }
  return sum;
}
function emptied() {
  const list: number[] = [];
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    list.length = 0;
    for (let i = 0; i < 4; i++) list.push(i + turn);
    for (let i = 0; i < list.length; i++) sum += list[i] % 3;
  }
  return sum;
}
function lengthOfPattern() {
  const list: number[] = [];
  for (let i = 0; i < 3; i++) list.push(i);
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    if (turn === 3) ({ length: list.length } = { length: 6 });
    for (let i = 0; i < list.length; i++) sum += list[i] === undefined ? 1000 : list[i];
  }
  return sum;
}
function takenAway() {
  const list: Item[] = [item(1), item(2), item(3)];
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    if (turn === 3) delete list[1];
    for (let i = 0; i < list.length; i++) sum += valueOf(list[i]);
  }
  return sum;
}
function defined() {
  const list: Item[] = [item(1), item(2), item(3)];
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    if (turn === 3) Object.defineProperty(list, 6, { value: item(50), writable: true, enumerable: true, configurable: true });
    for (let i = 0; i < list.length; i++) sum += valueOf(list[i]);
  }
  return sum;
}
function written() {
  const list: (number | undefined)[] = [1, , 3];
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) for (let i = 0; i < list.length; i++) sum += list[i] ?? 100;
  return sum;
}
function writtenWithValues(value: number) {
  const list: (number | undefined)[] = [value, , value + 1];
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) for (let i = 0; i < list.length; i++) sum += list[i] ?? 100;
  return sum;
}
function mapped() {
  const list = [1, , 3].map(value => item(value!));
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) for (let i = 0; i < list.length; i++) sum += valueOf(list[i]);
  return sum;
}
function copied() {
  const first: Item[] = [item(1), item(2), item(3), item(4)];
  first[7] = item(50);
  const list = first.slice(1);
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) for (let i = 0; i < list.length; i++) sum += valueOf(list[i]);
  return sum;
}
function joined() {
  const first: Item[] = [item(1), , item(3)] as Item[];
  const list = [item(7)].concat(first);
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) for (let i = 0; i < list.length; i++) sum += valueOf(list[i]);
  return sum;
}
function joinedWithSpreadable() {
  const spreadable: any = { length: 3, 0: item(4), 2: item(5), [Symbol.isConcatSpreadable]: true };
  const list: Item[] = ([item(7)] as Item[]).concat(spreadable);
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) for (let i = 0; i < list.length; i++) sum += valueOf(list[i]);
  return sum;
}
function cutOut() {
  const first: Item[] = [item(1), , item(3)] as Item[];
  const list = first.splice(0, 2);
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) for (let i = 0; i < list.length; i++) sum += valueOf(list[i]);
  return sum;
}
function copiedOnceMore() {
  const first: Item[] = [item(1), , item(3)] as Item[];
  const list = first.slice().slice().map(read => read);
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) for (let i = 0; i < list.length; i++) sum += valueOf(list[i]);
  return sum;
}
function oneOfTwo(first: boolean) {
  const whole: Item[] = [item(1), item(2), item(3)];
  const other: Item[] = [item(4), item(5), item(6)];
  other.length = 5;
  const list = first ? whole : other;
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) for (let i = 0; i < list.length; i++) sum += valueOf(list[i]);
  return sum;
}
function rowOfSeveral() {
  const rows: number[][] = [];
  rows.push([1, 2, 3]);
  rows.push([4, 5, 6]);
  rows[1][5] = 9;
  let sum = 0;
  for (let turn = 0; turn < turns; turn++)
    for (const row of rows) for (let i = 0; i < row.length; i++) sum += row[i] === undefined ? 1000 : row[i];
  return sum;
}
function thisList(this: Item[]) {
  this[this.length + 1] = item(50);
}
function storedThroughThis() {
  const list: Item[] = [item(1), item(2), item(3)];
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    if (turn === 3) thisList.call(list);
    for (let i = 0; i < list.length; i++) sum += valueOf(list[i]);
  }
  return sum;
}
function whole() {
  const list: Item[] = [];
  let sum = 0;
  for (let turn = 0; turn < turns; turn++) {
    list.push(item(turn), item(turn * 2));
    list.unshift(item(9));
    list.reverse();
    list.splice(1, 1, item(3), item(4));
    list.sort((a, b) => a.value - b.value);
    list.copyWithin(0, 1, 2);
    list.fill(item(8), 0, 1);
    for (let i = 0; i < list.length; i++) sum += list[i].value;
    for (const { value } of list) sum += value;
    list.pop();
    list.shift();
  }
  return sum + list.length;
}

for (const run of [
  storedElsewhere, storedByPattern, storedByHeadOfLoop, storedIfAbsent, lengthened, shortenedAndLengthened, emptiedAndLengthened, emptied,
  lengthOfPattern, takenAway, defined, written, () => writtenWithValues(turns), mapped, copied, joined, joinedWithSpreadable, cutOut,
  copiedOnceMore, () => oneOfTwo(true), () => oneOfTwo(false), rowOfSeveral, storedThroughThis, whole,
])
  console.log(run());
