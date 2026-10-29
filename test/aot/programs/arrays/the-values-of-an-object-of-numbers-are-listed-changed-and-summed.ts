function show(list: unknown[]): string {
  const parts: string[] = [];
  for (let index = 0; index < list.length; index++) parts.push(index in list ? (Object.is(list[index], -0) ? "-0" : String(list[index])) : "hole");
  return `${list.length}[${parts.join(",")}] ${Object.keys(list).join("")}`;
}
const lines: string[] = [];
const marks = { math: 5, art: 3, music: 4 };
const fractions = { a: 0.5, b: -0, c: NaN, d: Infinity, e: 2147483648 };
const mixed = { n: 1, s: "two", u: undefined, z: null, o: { toString: () => "obj" } };
const optional: { a: number; b?: number; c?: number } = { a: 1, c: 3 };
const one = { only: 7 };
const none = {};
function sumOf(record: Record<string, number>): number {
  let sum = 0;
  for (const value of Object.values(record)) sum += value;
  return sum;
}
for (let turn = 0; turn < 3; turn++) {
  marks.art += turn;
  fractions.a *= 2;
  lines.push(show(Object.values(marks)) + " " + show(Object.values(fractions)) + " " + show(Object.values(mixed)) + " " + show(Object.values(optional)));
  lines.push(show(Object.values(one)) + " " + show(Object.values(none)) + " " + sumOf(marks) + " " + sumOf(fractions) + " " + sumOf(one) + " " + sumOf(none));
  const values = Object.values(marks);
  for (let index = 0; index < values.length; index++) values[index] = values[index]! / 2 + turn;
  values.push(NaN);
  lines.push(show(values));
  (values as unknown[]).push("text");
  values.length = 7;
  lines.push(show(values) + " " + JSON.stringify(values) + " " + values.indexOf(NaN) + " " + values.includes(NaN));
  optional.b = turn ? turn + 0.25 : undefined;
}
const [first, ...rest] = Object.values(marks);
lines.push(first + " " + show(rest) + " " + Math.max(...Object.values(marks)) + " " + Object.values(marks).reverse().join("|") + " " + Object.values(marks).map(value => value * 2).join("|"));
let total = 0;
for (let turn = 0; turn < 500; turn++) {
  marks.music = turn;
  for (const mark of Object.values(marks)) total += mark;
}
lines.push("total " + total);
console.log(lines.join("\n"));
