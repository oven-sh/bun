// Lists of numbers that untyped code or a built-in function has made, read by functions that know a list by its type alone: a loop by index, a for-of loop, filter(), map() and reduce().
// Such a list has storage that can hold any value. Two are made anew in every turn, one holds a NaN for good. A list that is written as numbers comes to the same functions.
function collect(record: any): any {
  const list = [];
  for (const key in record) list.push(record[key]);
  return list;
}
const record = { a: 0.5, b: 1, c: 2.5, d: 3, e: 4.5, f: 5, g: 6.5, h: 7 };
const holdsNaN: number[] = collect({ ...record, d: NaN });
const written: number[] = [0.5, 1, 2.5, 3, 4.5, 5, 6.5, 7];

function indexed(list: number[]): number {
  let total = 0;
  for (let index = 0; index < list.length; index++) total += list[index];
  return total;
}
function walked(list: number[]): number {
  let total = 0;
  for (const value of list) total += value;
  return total;
}
function large(list: number[]): number {
  return list.filter(value => value > 4).length;
}
function doubled(list: number[]): number {
  return list.map(value => value * 2).length;
}
function folded(list: number[]): number {
  return list.reduce((total, value) => total + value, 0);
}

let total = 0;
let notNumbers = 0;
for (let turn = 0; turn < 40000; turn++) {
  for (const list of [written, Object.values(record), collect(record), holdsNaN]) {
    const sum = indexed(list) + walked(list) + folded(list);
    if (sum === sum) total += sum;
    else notNumbers++;
    total += large(list) + doubled(list);
  }
}
console.log(total, notNumbers);
