// A position that is typed `number` and comes from untyped code is tested once for an int32. Behind the test the reads, the comparison with the length and the sums made of the position work on the integer:
// no position is a double that each read turns back into an integer.
// IRT= 1 threeInARow = TypeTest v1 testedType=i32
// IRT= 1 threeInARow : int\[-2147483647, 2147483648\] = Add
// IRT= 1 threeInARow : int\[-2147483646, 2147483649\] = Add
// IRT= 1 twoOfAView = TypeTest v1 testedType=i32
// IRT= 1 twoOfAView : int\[-2147483647, 2147483648\] = Add
const parsed: any = JSON.parse('{"list":[0,1,2,3,4,5,6,7],"odd":[1.5,-1,-0,null,"2",61,62,63,64,4294967295,4294967296,1e300]}');
const texts: string[] = [];
for (let i = 0; i < 64; ++i) texts.push("t" + i);
const floats = new Float64Array(64);
for (let i = 0; i < 64; ++i) floats[i] = i * 1.5;

function threeInARow(a: string[], i: number): string {
  return a[i] + a[i + 1] + a[i + 2];
}
function twoOfAView(a: Float64Array, i: number): number {
  return a[i] + a[i + 1];
}

// Both are also handed on as values, so each keeps a body of its own.
const table: Function[] = [threeInARow, twoOfAView];
console.log(table[parsed.list[1]].name);

let length = 0;
let sum = 0;
for (let turn = 0; turn < 20000; ++turn) {
  length = (length + threeInARow(texts, parsed.list[turn & 7]).length) | 0;
  sum += twoOfAView(floats, parsed.list[turn & 7]);
}
console.log(length, sum);
for (const position of parsed.odd) console.log(String(position), threeInARow(texts, position), twoOfAView(floats, position));
