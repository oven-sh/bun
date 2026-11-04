// `left[i] === right[j]` on typed arrays of integers: each side is an integer, or undefined beyond the end. undefined equals undefined and no integer.
// With null in place of an element in front of the beginning: null equals null alone.
const left = new Int32Array([0, 1, -1, 2147483647, -2147483648, 7]);
const right = new Int32Array([0, 1, -1, 2147483647, -2147483648, 8, 7]);
const bytes = new Uint8Array([0, 1, 255, 7]);

function elementOrNull(view: Int32Array, index: number): number | null | undefined {
  return index < 0 ? null : view[index];
}

function countEqual(): string {
  let equal = 0;
  let different = 0;
  let rows = "";
  for (let i = 0; i < 9; i++) {
    let row = "";
    for (let j = 0; j < 9; j++) {
      if (left[i] === right[j]) equal++;
      if (left[i] !== right[j]) different++;
      row += left[i] === right[j] ? "=" : ".";
    }
    rows += row + "\n";
  }
  return equal + " " + different + "\n" + rows;
}

function countEqualWithNull(): string {
  let rows = "";
  for (let i = -2; i < 8; i++) {
    let row = "";
    for (let j = -2; j < 9; j++) row += elementOrNull(left, i) === elementOrNull(right, j) ? "=" : ".";
    rows += row + "\n";
  }
  return rows;
}

function countEqualAcrossWidths(): string {
  let rows = "";
  for (let i = 0; i < 8; i++) {
    let row = "";
    for (let j = 0; j < 6; j++) row += left[i] === bytes[j] ? "=" : bytes[j] !== left[i] ? "." : "?";
    rows += row + "\n";
  }
  return rows;
}

function countEqualToInteger(): string {
  let row = "";
  for (let i = 0; i < 9; i++) row += (left[i] === 7 ? "7" : ".") + (left[i] === i ? "i" : ".") + (i - 1 === right[i] ? "j" : ".");
  return row;
}

console.log(countEqual());
console.log(countEqualWithNull());
console.log(countEqualAcrossWidths());
console.log(countEqualToInteger());
