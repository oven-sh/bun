// STATISTIC: CallsInlined >= 1
let asked = 0;
function isLong(text: { length: number }): boolean {
  return text.length > 1;
}
function holds(box: { held: any }): boolean {
  return !!box.held && isLong(box.held);
}
function lacks(box: { held: any }): boolean {
  return !!!box.held || !!!isLong(box.held);
}
function says(value: any): string {
  asked++;
  const box = { held: value };
  return String(holds(box)) + lacks(box);
}
const proud = {
  length: 4,
  valueOf() {
    asked += 100;
    return 0;
  },
  toString() {
    asked += 1000;
    return "";
  },
  [Symbol.toPrimitive]() {
    asked += 10000;
    return 0;
  },
};
const values: any[] = [0, -0, NaN, 1, 0n, 1n, "", "a", "ab", null, undefined, false, true, [], [1, 2], {}, { length: 2 }, proud, Symbol.iterator, () => 1, (a: any, b: any) => a + b, new String(""), new Boolean(false), new Number(0)];
const said: string[] = [];
for (const value of values) said.push(says(value));
console.log(said.join(" "), asked);
